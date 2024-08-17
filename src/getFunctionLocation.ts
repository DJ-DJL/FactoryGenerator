import Inspector from "node:inspector";
import { SourceMapConsumer } from 'source-map-js';
import FS from 'fs';
import Path from 'path';

const inspector = (new Inspector.Session());
const parsedFiles = new Map<string, string>();
inspector.connect();
inspector.on('Debugger.scriptParsed', (result) => {
    parsedFiles.set(result.params.scriptId, result.params.url); // TODO: Improve to utilise sourcemap?
});
inspector.post('Debugger.enable');


export async function getMappedFunctionLocation(func: Function): Promise<{ filename: string, line: number, col: number }> {
    const unmappedLocation = await getFunctionLocation(func);
    let sourceMapFilename;
    if (unmappedLocation.sourceMapURL) {
        sourceMapFilename = unmappedLocation.sourceMapURL;
    } else if (FS.existsSync(`${unmappedLocation.filename}.map`)) {
        sourceMapFilename = `${unmappedLocation.filename}.map`;
    } else {
        // no sourcemap available
        return unmappedLocation;
    }
    const consumer = await getSourceMapConsumer(sourceMapFilename);
    const mapped = consumer.originalPositionFor({ line: unmappedLocation.line, column: unmappedLocation.col });
    return {
        filename: Path.resolve(Path.dirname(unmappedLocation.filename), mapped.source),
        line: mapped.line,
        col: mapped.column
    }
}
export async function getSourceMapConsumer(sourceMapFilename: string) {
    const sourceMapContent = await FS.promises.readFile(sourceMapFilename, 'utf8');
    const consumer = new SourceMapConsumer(JSON.parse(sourceMapContent));
    return consumer;
}

export async function getFunctionLocation(func: Function): Promise<{ filename: string, line: number, col: number, sourceMapURL: string }> {
    // console.log(func.name, func);
    const globalPropName = getRandomPropName();
    (globalThis as any)[globalPropName] = func;
    try {
        return await new Promise((r, x) => {
            inspector.post(`Runtime.evaluate`, { expression: `global[${JSON.stringify(globalPropName)}]` }, (err, { result }) => {
                if (err) {
                    return x(err);
                }
                inspector.post(`Runtime.getProperties`, { objectId: result.objectId }, (err, result: any) => {
                    if (err) {
                        return x(err);
                    }
                    // console.log(result.internalProperties);
                    const functionLocationProperty = result.internalProperties.find((prop: any) => prop.name === `[[FunctionLocation]]`);
                    const functionLocation = functionLocationProperty.value.value;
                    r({
                        filename: new URL(parsedFiles.get(functionLocation.scriptId)!).pathname,
                        line: functionLocation.lineNumber,
                        col: functionLocation.columnNumber,
                        sourceMapURL: functionLocation.sourceMapURL,
                    });
                });
            });
        });
    } finally {
        delete (globalThis as any)[globalPropName]; // clean up after ourselves
    }
}


export function getRandomPropName() {
    const random8Chars = () => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0');
    const randomPropName = `____${random8Chars()}${random8Chars()}${random8Chars()}${random8Chars()}`;
    if (randomPropName in globalThis) {
        // that was unlucky
        return getRandomPropName();
        // yes, I know this is inefficient but the alternative necessitates the use of let instead of const, which I don't like and tbh "unlucky" is an understatement...
    }
    return randomPropName;
}

