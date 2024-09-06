import Inspector from "node:inspector";
import { SourceMapConsumer } from 'source-map-js';
import FS from 'fs';
import Path from 'path';

const { parsedFiles, post } = initInspector();

function initInspector() {
    const inspector = (new Inspector.Session());
    const parsedFiles = new Map<string, string>();
    inspector.connect();
    inspector.on('Debugger.scriptParsed', (result) => {
        parsedFiles.set(result.params.scriptId, result.params.url);
    });
    inspector.post('Debugger.enable');
    return { inspector, parsedFiles, post };

    function post(method: string, params?: object): Promise<object | undefined> {
        return new Promise((r, x) => {
            if (params) {
                inspector.post(method, params, cb);
            } else {
                inspector.post(method, cb);
            }
            function cb(err: Error | null, result: object | undefined): void {
                if (err) {
                    return x(err);
                }
                r(result);
            };
        })
    }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- This is actually supposed to work with any function. The function will not be invoked so we don't need any further type info.
export async function getMappedFunctionLocation(func: Function): Promise<FunctionLocation> {
    const unmappedLocation = await getFunctionLocation(func);
    const sourceMapFilename = getSourceMapFilename(unmappedLocation);
    if (!sourceMapFilename) {
        return unmappedLocation;
    }
    const consumer = await getSourceMapConsumer(sourceMapFilename);
    const mappedLocation = consumer.originalPositionFor({ line: unmappedLocation.line, column: unmappedLocation.col });
    return {
        filename: Path.resolve(Path.dirname(unmappedLocation.filename), mappedLocation.source),
        line: mappedLocation.line,
        col: mappedLocation.column
    }
}

function getSourceMapFilename(unmappedLocation: FunctionLocationWithMap): string | null {
    if (unmappedLocation.sourceMapURL) {
        return unmappedLocation.sourceMapURL;
    }
    if (FS.existsSync(`${unmappedLocation.filename}.map`)) {
        return `${unmappedLocation.filename}.map`;
    }
    return null; // no sourcemap available
}

export async function getSourceMapConsumer(sourceMapFilename: string) {
    const sourceMapContent = await FS.promises.readFile(sourceMapFilename, 'utf8');
    const consumer = new SourceMapConsumer(JSON.parse(sourceMapContent));
    return consumer;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- This is actually supposed to work with any function. The function will not be invoked so we don't need any further type info.
export async function getFunctionLocation(func: Function): Promise<FunctionLocationWithMap> {
    // unfortunately this will pollute the global, but we will clean it up before we return anything
    const globalPropName = getRandomPropName();
    (globalThis as any)[globalPropName] = func;
    try {
        const expression = `global[${JSON.stringify(globalPropName)}]`;
        const { result: { objectId } } = await post(`Runtime.evaluate`, { expression }) as any;
        const properties = await post(`Runtime.getProperties`, { objectId: objectId });
        return getFunctionLocationFromRuntimeProperties(properties);

    } finally {
        delete (globalThis as any)[globalPropName]; // clean up after ourselves
    }
}

type FunctionLocation = {
    filename: string;
    line: number;
    col: number;
};

type FunctionLocationWithMap = FunctionLocation & {
    sourceMapURL: string;
};

function getFunctionLocationFromRuntimeProperties(result: any): FunctionLocationWithMap {
    const functionLocationProperty = result.internalProperties.find((prop: any) => prop.name === `[[FunctionLocation]]`);
    const functionLocation = functionLocationProperty.value.value;
    const ret = {
        filename: new URL(parsedFiles.get(functionLocation.scriptId)!).pathname,
        line: functionLocation.lineNumber,
        col: functionLocation.columnNumber,
        sourceMapURL: functionLocation.sourceMapURL,
    };
    return ret;
}

export function getRandomPropName() {
    // After a conversation with chatGPT we determined that the expected mean time between collisions is approx. 1.17 years using a high spec CPU in 2024 calling this function on every clock cycle on 64 cores of a 5GZ CPU (which is obviously impossible due to the single-threadedness of nodeJS)
    // in other words - don't worry about it unless there is a quantum leap in technology.
    const random8Chars = () => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0'); // eslint-disable-line sonarjs/pseudo-random -- I am confident that it's safe to use pseudo random numbers here
    const randomPropName = `___gfl_${random8Chars()}${random8Chars()}${random8Chars()}${random8Chars()}`;
    if (randomPropName in globalThis) {
        // that was unlucky
        return getRandomPropName();
        // yes, I know this is inefficient but the alternative necessitates the use of let instead of const, which I don't like. And tbh "unlucky" is an understatement...
    }
    return randomPropName;
}
