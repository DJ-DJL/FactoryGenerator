/* eslint-disable @typescript-eslint/no-unsafe-function-type -- Function type is used a lot in this file. In most cases we don't actually know the signature of the function, so we'll just disable this rule here */
// Time spent trying to make this file readable: 13 hours
import FS from 'fs';
import Path from 'path';
import TypeScript from 'typescript';
import { getMappedFunctionLocation } from './getFunctionLocation.js';
import Crypto from 'node:crypto'
import boxComment from '@djleehaha/boxcomments';
import { id, cast, typeRef, spread, keyOf, exportKeyword, extend, mkParam, blockCommentBefore, mkTemplateLiteral } from './typeScriptFactoryHelpers.js';
import { mkStaticFunction } from './typeScriptFactoryHelpers.js';

type GenericAbstractConstructor<T> = abstract new (...args: any[]) => T;
// type AbstractConstructor = abstract new (...args: any[]) => any;
type Specialisation<T extends Function> = {
    constr: T;
    srcFileName: string;
    exportName: string;
};
class FactoryBuilder<T extends Function> extends Set<Specialisation<T>>{

    constructor(private baseClass: GenericAbstractConstructor<T>, public outFile: string, private discriminatingProperty: string = 'typeName') {
        super();
    }
    async generate(reason: string) {
        console.log(`\x1B[0m${FS.existsSync(this.outFile) ? 'Reg' : 'G'}enerating \x1B[35m${this.baseClass.name}\x1B[0m factory because ${reason}`);

        await this.warnForDuplicateTypes();
        const uniqueNames = new Map<Specialisation<T>, string>();
        for (const specialisation of this) {
            uniqueNames.set(specialisation, `cls_${hash(specialisation.srcFileName, specialisation.exportName)}`);
        }
        const imports = this.generateImports(uniqueNames);
        const typeMappings = this.generateTypeMappings(uniqueNames);
        const typeMappingsType = this.generateTypeMappingsType();
        const typeWithError = this.generateTypeWithError();
        const cls = this.generateFactoryClass();
        const err = this.generateErrorClass();
        const codeOutputs = await ast2code();

        const out = FS.createWriteStream(this.outFile, 'utf8');
        out.write(await this.generateOpeningComment());
        out.write('\n');
        for (const codeOut of codeOutputs) {
            out.write(codeOut);
            out.write(';\n');
        }
        out.end();

        async function ast2code() {
            const codeOutputs = [];
            const printer = TypeScript.createPrinter({ newLine: TypeScript.NewLineKind.LineFeed, omitTrailingSemicolon: true });
            const sourceFile = TypeScript.createSourceFile(`dummy.ts`, ``, TypeScript.ScriptTarget.Latest, false, TypeScript.ScriptKind.TS);
            for await (const node of concatAsyncIterables<TypeScript.Node>(imports, typeMappings, typeMappingsType, typeWithError, cls, err)) {
                codeOutputs.push(printer.printNode(TypeScript.EmitHint.Unspecified, node, sourceFile));
            }
            return codeOutputs;
        }
    }

    private async warnForDuplicateTypes() {
        const typeNames2 = groupBy(this, specialisation => (specialisation.constr as any)[this.discriminatingProperty] as string);
        for (const [typeName, specialisations] of typeNames2) {
            if (specialisations.length > 1) {
                const formattedLocations = specialisations.map(f => formatFunctionSrcLocation(f.constr));
                const references = (await Promise.all(formattedLocations)).join('\n                            ');
                console.warn(`\x1B[33mWARNING\x1B[0m - Multiple classes use the same value for \x1B[35m${this.discriminatingProperty} \x1B[0m(\x1B[33m${typeName}\x1B[0m).
      References found: ${references}`);
            }
        }
    }
    private generateTypeMappings(uniqueNames: Map<Specialisation<T>, string>): TypeScript.Node {
        // generates code like the following:
        // const typeMappings = {
        //  ExportName1: "cls_uniqueID",
        //  ExportName2: "cls_uniqueID",
        //  etc.
        // } as const
        const propertyAssignments = [...uniqueNames.entries()].map(([specialisation, uniqueName]) => {
            return TypeScript.factory.createPropertyAssignment(
                (specialisation.constr as any)[this.discriminatingProperty],
                id(uniqueName)
            );
        });

        return TypeScript.factory.createVariableDeclarationList([ // const
            TypeScript.factory.createVariableDeclaration( // typeMappings =
                /*name*/ `typeMappings`,
                /*exclamationToken*/ undefined,
                /* type */ undefined,
                cast( // as const
                    TypeScript.factory.createObjectLiteralExpression(
                        /*properties*/ propertyAssignments,
                        /*multiline*/ true
                    ),
                    typeRef(`const`)
                ),
            )
        ], TypeScript.NodeFlags.Const);
    }
    private generateTypeMappingsType(): TypeScript.Node {
        return TypeScript.factory.createTypeAliasDeclaration(
            /* modifiers*/[exportKeyword()],
            /* name */ id(`Specialisation`),
            /* TypeParameters*/ undefined,
            /* type  */ keyOf(typeRef(id(`typeof typeMappings`)))
        );
    }
    private generateTypeWithError(): TypeScript.Node {
        const name = id(`BaseClass`);
        const type = typeRef(id(this.baseClass.name));
        const node = TypeScript.factory.createTypeAliasDeclaration([], name, undefined, type);
        const hasTrailingNewline = false;
        const commentContent = "@ts-ignore - If the type is generic we can't cope with that, so we'll just ignore the error (it works just fine at runtime). Use the alias on all subsequent lines to avoid ignoring other errors inadvertently";
        return TypeScript.addSyntheticLeadingComment(node, TypeScript.SyntaxKind.SingleLineCommentTrivia, commentContent, hasTrailingNewline);
    }
    private generateErrorClass(): TypeScript.Node {
        return TypeScript.factory.createClassDeclaration([exportKeyword()], `${this.baseClass.name}FactoryCreateError`, undefined, [extend(`Error`)], []);
    }
    private generateFactoryClass(): TypeScript.Node {
        return TypeScript.factory.createClassDeclaration(
            [exportKeyword()],
            `${this.baseClass.name}Factory`,
            /* type parameters */ undefined,
            /* heritageClauses */ undefined,
            /* members */[this.generateFactoryCreateFunction()])
    }
    private generateFactoryCreateFunction(): TypeScript.ClassElement {
        return mkStaticFunction(
            `create`,
            [
                mkParam(this.discriminatingProperty, 'Specialisation', false),
                mkParam(`init`, `any[]`, true),
            ],
            typeRef("BaseClass"),
            this.generateFactoryCreateFunctionBody()
        );
    }
    private generateFactoryCreateFunctionBody() {
        return TypeScript.factory.createBlock(
            /*statements*/[
                this.mkConstrVar(), // const constr = typeMappings[typeName];
                this.mkCheckForConstructorFound(), // if (!constr) { throw ... }
                (mkSpreadConstructorTypeWithComment()), // type SpreadConstructor = {new (...args: any[]): BaseClass;};
                (mkReturnStatement()) // return new (constr as unknown as SpreadConstructor)(...init);
            ], true
        );
        function mkSpreadConstructorTypeWithComment() {
            const commentContent = removeLeadingIndentations`
        Typescript does not allow using spread when the parameters are known (and are not spread).
        But the FactoryGenerator code generating this function does not know the parameters!
        Hence we need to cast the constructor to something that uses spread parameters
        `;
            return blockCommentBefore(commentContent, mkSpreadConstructorType());
        }
        function mkSpreadConstructorType() {
            const typeDefinition = TypeScript.factory.createTypeLiteralNode(
                [TypeScript.factory.createConstructSignature(
                    undefined,
                    [mkParam(`args`, `any[]`, true)],
                    typeRef("BaseClass", undefined)
                )]);
            return TypeScript.factory.createTypeAliasDeclaration([], `SpreadConstructor`, undefined, typeDefinition);
        }
        function mkReturnStatement() {
            const castConstrAsSpreadConstructorViaUnknown = cast(cast(id(`constr`), typeRef('unknown')), typeRef('SpreadConstructor'));
            const args = [
                spread(
                    id('init')
                )
            ];
            const returnStatement = TypeScript.factory.createReturnStatement(TypeScript.factory.createNewExpression(castConstrAsSpreadConstructorViaUnknown, undefined, args));
            return returnStatement;
        }
    }

    private mkCheckForConstructorFound() {
        return TypeScript.factory.createIfStatement(
            TypeScript.factory.createPrefixUnaryExpression(TypeScript.SyntaxKind.ExclamationToken, id(`constr`)),
            TypeScript.factory.createBlock([
                this.mkThrowOnInvalidType()
            ]));
    }

    private mkThrowOnInvalidType(): TypeScript.Statement {
        const errorMessage = mkTemplateLiteral(``, id(this.discriminatingProperty), ` is not a valid value for \`${this.discriminatingProperty}\``);
        return TypeScript.factory.createThrowStatement(
            TypeScript.factory.createNewExpression(
                id(`${this.baseClass.name}FactoryCreateError`),
                undefined,
                [errorMessage]
            )
        );
    }

    private mkConstrVar() {
        const initialiser = TypeScript.factory.createElementAccessExpression(
            id(`typeMappings`),
            id(this.discriminatingProperty)
        );

        const declarations = [TypeScript.factory.createVariableDeclaration(`constr`, undefined, undefined, initialiser)];
        const extractConstructorToVariable = TypeScript.factory.createVariableStatement(
            [],
            TypeScript.factory.createVariableDeclarationList(declarations, TypeScript.NodeFlags.Const)
        );
        return extractConstructorToVariable;
    }

    private async generateOpeningComment() {
        const sourceFiles = new Set<string>();
        for (const specialisation of this.values()) {
            sourceFiles.add(Path.relative(this.outFile, (await getMappedFunctionLocation(specialisation.constr as Function)).filename));
        }
        return boxComment([
            `WARNING: This file is auto-generated by theFactoryGenerator module.`,
            ``,
            `Any changes made directly in this file may be overwritten the next time the generator runs.`,
            ``,
            `To modify the behavior of this file, update the source files and rerun the generator instead.`,
            ``,
            `Sources:`,
            ...sourceFiles,
        ], Number.MAX_SAFE_INTEGER);
    }
    private async *generateImports(uniqueNames: Map<Specialisation<T>, string>) {
        const mappedFunctionLocation = await getMappedFunctionLocation(this.baseClass);
        const fixedSrcFilename = mappedFunctionLocation.filename.replace(/.ts$/, '.js');
        const importPath = Path.relative(Path.dirname(this.outFile), fixedSrcFilename);
        yield mkImport(importPath, this.baseClass.name);
        for await (const specialisation of this) {
            if (!(this.discriminatingProperty in (specialisation.constr as any))) {
                console.error(`\x1B[31mERROR\x1B[0m: ${await formatFunctionSrcLocation(specialisation.constr as Function)}\x1B[0m - \x1B[35m${specialisation.exportName}\x1B[0m is missing discriminating property ${this.discriminatingProperty}`);
            }
            if (typeof (specialisation.constr as any)[this.discriminatingProperty] !== 'string') {
                console.error(`\x1B[31mERROR\x1B[0m: ${await formatFunctionSrcLocation(specialisation.constr as Function)}\x1B[0m - \x1B[35m${specialisation.exportName}\x1B[0m's discriminating property ${this.discriminatingProperty} is not a string`);
            }
            const uniqueName = uniqueNames.get(specialisation)!;
            yield mkImport(Path.relative(Path.dirname(this.outFile), specialisation.srcFileName.replace('dist', 'src')), [specialisation.exportName, uniqueName]);
        }
    }

    removeExistingFileReferences(modulePath: string) {
        let somethingWasDeleted = false
        for (const thing of this) {
            if (Path.resolve(thing.srcFileName) === Path.resolve(modulePath)) {
                this.delete(thing);
                somethingWasDeleted = true
            }
        }
        return somethingWasDeleted;
    }
}

type runPropertyBag = {
    ignorePaths: string[];
};

export default class FactoriesBuilder {
    static readonly #factoryBuilders: Map<Function, FactoryBuilder<Function>> = new Map();

    static createFactoryBuilder<T extends Function>(baseClass: GenericAbstractConstructor<T>, outFile: string, discriminatingProperty: string = 'typeName') {
        if (this.#isRunning) {
            console.warn(`\x1B[33m WARNING\x1B[0m: Adding a new FactoryBuilder after calling \x1B[35m.run\x1B[0m will not scan for existing files.`);
        }
        const builder = new FactoryBuilder(baseClass, outFile, discriminatingProperty);
        this.#factoryBuilders.set(baseClass, builder as FactoryBuilder<Function>);
    }

    static #isFactoryBuilderOutputFile(modulePath: string) {
        for (const factoryBuilder of this.#factoryBuilders.values()) {
            if (Path.resolve(modulePath) === Path.resolve(factoryBuilder.outFile)) {
                return true;
            }
            if (isMappedFromFactoryBuilderOutputFile(factoryBuilder)) {
                return true;
            }
        }
        return false;

        function isMappedFromFactoryBuilderOutputFile(factoryBuilder: FactoryBuilder<Function>) {
            const sourceMap = readSourceMap(modulePath);
            if (!sourceMap) {
                return false;
            }
            for (const source of sourceMap.sources) {
                if (Path.resolve(Path.dirname(modulePath), source) === Path.resolve(factoryBuilder.outFile)) {
                    return true;
                }
            }
            return false;

            function readSourceMap(modulePath: string) {
                const sourceMapPath = `${modulePath}.map`;
                if (!FS.existsSync(sourceMapPath)) {
                    return;
                }
                return JSON.parse(FS.readFileSync(sourceMapPath, 'utf8'));
            }
        }
    }

    static async #loadModule(modulePath: string): Promise<any> {
        try {
            return await import(`${modulePath}?${new Date().valueOf()}`);
        } catch (ex) {
            console.log(`\x1B[33mWARNING\x1B[0m - Could not load module \x1B[0m ${modulePath}: ${(ex as Error).message} `)
        }
    }
    static #isRunning: boolean = false; // eslint-disable-line sonarjs/public-static-readonly -- it's not public!
    static get isRunning() { return this.#isRunning; }
    static async run(srcPath: string, { ignorePaths }: runPropertyBag) {
        if (this.#isRunning) {
            return;
        }
        this.#isRunning = true;

        console.log(`Looking for src files in ${srcPath}`);
        await FactoriesBuilder.scan(srcPath, ignorePaths);
        // const watcher = Chokidar.watch(
        //     Path.resolve(srcPath),
        //     { persistent: true, ignoreInitial: true }
        // );

        // async function considerChangedFile(type: string, path: string) {
        //     if (FactoriesBuilder.isPathIgnored(path, ignorePaths)) {
        //         return;
        //     };
        //     if (path && ['.js', '.mjs'].includes(Path.extname(path))) {
        //         // console.log(`\x1B[34m ${type} \x1B[0m ${path}`);
        //         for (const builder of await FactoriesBuilder.considerFile(path, ignorePaths)) {
        //             await builder.generate(`\x1B[34m${path}\x1B[0m was written to`);
        //         }
        //     }
        // }

        // watcher.on('add', path => considerChangedFile('add', path));
        // watcher.on('change', path => considerChangedFile('change', path));
        // T/ODO: Handle deletes and errors
        for (const builder of FactoriesBuilder.#factoryBuilders.values()) {
            await builder.generate(`Initial build`);
        }
    }
    static isPathIgnored(path: string, ignorePaths: string[]): boolean {
        for (const ignorePath of ignorePaths) {
            if (!Path.relative(Path.resolve(ignorePath), Path.resolve(path)).startsWith('../')) {
                return true;
            }
        }
        return false;
    }
    static #shouldIgnoreFile(modulePath: string, ignoredPaths: string[]) {
        if (Path.resolve(modulePath) === Path.resolve(import.meta.filename)) {
            return true;
        }
        if (this.#isFactoryBuilderOutputFile(modulePath)) {
            return true;
        }
        if (FactoriesBuilder.isPathIgnored(modulePath, ignoredPaths)) {
            return true;
        }
    }
    static async considerFile(modulePath: string, ignoredPaths: string[]): Promise<Iterable<FactoryBuilder<Function>>> {
        const affectedBuilders = new Set<FactoryBuilder<Function>>();
        for (const builder of this.#factoryBuilders.values()) {
            if (builder.removeExistingFileReferences(modulePath)) {
                affectedBuilders.add(builder);
            }
        }
        if (this.#shouldIgnoreFile(modulePath, ignoredPaths)) {
            return [];
        }
        const module = await this.#loadModule(modulePath);
        if (!module) {
            return [];
        }
        for (const [exportName, exported] of Object.entries(module)) {
            for (const [baseClass, builder] of this.#factoryBuilders) {
                await this.#considerExport(modulePath, exported, baseClass, builder, exportName, affectedBuilders);
            }
        }
        return affectedBuilders.values();
    }
    static async #considerExport(modulePath: string, exported: unknown, baseClass: Function, builder: FactoryBuilder<Function>, exportName: string, affectedBuilders: Set<FactoryBuilder<Function>>) {
        if ((typeof exported) !== 'function') {
            return;
        }
        if (typeof exported === 'function' && exported.prototype instanceof baseClass) { // repeating the typeof check is not required at runtime, but it helps typescript infer types
            builder.add({
                srcFileName: Path.resolve(modulePath),
                exportName,
                constr: exported
            });
            affectedBuilders.add(builder);
            return;
        }
        // walk the prototype chain to check for inheritance that matches the base class's name and emit a warning about it
        await this.#checkForPossiblyBadInheritance(exported as Function, baseClass, exportName);
    }

    static async  #checkForPossiblyBadInheritance(exported: Function, baseClass: Function, exportName: string) {
        let proto = Object.getPrototypeOf(exported);
        while (proto && proto !== Function.prototype) {
            if (proto.name === baseClass.name) {
                console.warn(`\x1B[33mWARNING\x1B[0m - ${await formatFunctionSrcLocation(exported)}\x1B[0m - class \x1B[35m${exportName}\x1B[0m inherits from a class called \x1B[35m${proto.name}\x1B[0m(${await formatFunctionSrcLocation(proto)}\x1B[0m) but this does not appear to be the same class as \x1B[35m${baseClass.name}\x1B[0m(${await formatFunctionSrcLocation(baseClass)}\x1B[0m)
Possible causes:
1. \x1B[35m${exportName}\x1B[0m is defined in the same file as \x1B[35m${baseClass.name}\x1B[0m - This is, unfortunately, not supported for complex reasons to do with dynamic import, cache validation and the change tracking feature of this application.
2. There genuinely is more than 1 \x1B[35m${proto.name}\x1B[0m class and \x1B[35m${exportName}\x1B[0m is derived from the other one. If this is intentional then this warning can be ignored.\x1B[0m`);
            }
            proto = Object.getPrototypeOf(proto);
        }
    }

    private static async scan(path: string, ignoredPaths: string[]) {
        const files = FS.readdirSync(path, { withFileTypes: true, recursive: true }).filter(f => f.isFile() && ['.js', '.mjs'].includes(Path.extname(f.name)));
        for (const file of files) {
            const modulePath = Path.join(file.parentPath, file.name);
            await FactoriesBuilder.considerFile(modulePath, ignoredPaths);
        }
    }
}

function mkImport(importPath: string, ...importNames: (string | [string, string])[]) {
    function mkImportSpecifier(importName: string): TypeScript.ImportSpecifier;
    function mkImportSpecifier([importName, as]: [string, string]): TypeScript.ImportSpecifier;
    function mkImportSpecifier(importNameMap: string | [string, string]): TypeScript.ImportSpecifier;
    function mkImportSpecifier(importNameMap: string | [string, string]): TypeScript.ImportSpecifier {
        const [importName, as] = Array.isArray(importNameMap) ? importNameMap : [importNameMap, undefined];
        return TypeScript.factory.createImportSpecifier(
            /* isTypeOnly */ false,
            /* propertyName (as) */ as ? id(importName) : undefined, // ⎰ this is a bit weird. If we're aliasing then we pass the alias as "name" and the
            /* name */ id(as ? as : importName), //                     ⎱ original name as propertyName, otherwise we pass the original name as "name" - crazy!
        );
    }
    const isTypeOnly = false;
    const name = undefined;
    const namedBindings = TypeScript.factory.createNamedImports(importNames.map(mkImportSpecifier));
    const importClause = TypeScript.factory.createImportClause(isTypeOnly, name, namedBindings);

    const modifiers = undefined;
    const moduleSpecifier = TypeScript.factory.createStringLiteral(importPath);
    return TypeScript.factory.createImportDeclaration(modifiers, importClause, moduleSpecifier);
}

async function formatFunctionSrcLocation<T extends Function>(func: T, ansi: boolean = true) {
    const srcLocation = await getMappedFunctionLocation(func);
    const relativePath = Path.relative(".", srcLocation.filename);
    if (ansi) {
        return `\x1B[36m${relativePath}:\x1B[93m${srcLocation.line}\x1B[0m:\x1B[93m${srcLocation.col}`;
    }
    return `${relativePath}:${srcLocation.line}:${srcLocation.col}`;
}

function hash(...strings: string[]) {
    const hash = Crypto.createHash('sha512');
    for (const str of strings) {
        hash.update(str);
    }
    return hash.digest('hex'); // the hex string generated is stupidly long. But each one is used on only 2 lines so... whatever
}


// eslint-disable-next-line sonarjs/cognitive-complexity -- complexity is 11: 1 over the threshold. A slightly less complex version is possible but I think it's actually harder to understand (and possibly less performant too) See commented code below this function
async function* concatAsyncIterables<T>(...iterables: (AsyncIterable<T> | Iterable<T> | T)[]): AsyncGenerator<T> {
    for (const item of iterables) {
        if (Symbol.asyncIterator in (item as any)) {
            for await (const value of item as AsyncIterable<T>) {
                yield value;
            }
        } else if (Symbol.iterator in (item as any)) {
            for (const value of item as Iterable<T>) {
                yield value;
            }
        } else {
            yield item as T;
        }
    }
//     for (const item of iterables) {
//         for await (const value of handleItem(item)) {
//             yield value;
//         }
//     }
//     async function* handleItem<T>(item: AsyncIterable<T> | Iterable<T> | T): AsyncGenerator<T> {
//         if (Symbol.asyncIterator in (item as any)) {
//             for await (const value of item as AsyncIterable<T>) {
//                 yield value;
//             }
//         } else if (Symbol.iterator in (item as any)) {
//             for (const value of item as Iterable<T>) {
//                 yield value;
//             }
//         } else {
//             yield item as T;
//         }
//     }
}

function groupBy<T, U>(src: Iterable<T>, keySelector: (item: T) => U) {
    const out = new Map<U, T[]>();
    for (const item of src) {
        const key = keySelector(item);
        if (!out.has(key)) {
            out.set(key, []);
        }
        out.get(key)!.push(item);
    }
    return out;
}



function removeLeadingIndentations(strings: TemplateStringsArray, ...values: any[]) {
    const out = [];
    for (let i = 0; i < strings.length; i++) {
        const trimmed = strings[i].split('\n').map(s => s.trimStart()).join('\n');
        out.push(trimmed);
        out.push((values[i] ?? '').toString());
    }
    return out.join('');
}


