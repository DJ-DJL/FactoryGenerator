import FS from 'fs';
import Path from 'path';
import TypeScript from 'typescript';
import { getMappedFunctionLocation, getSourceMapConsumer } from './getFunctionLocation.js';
import Chokidar from 'chokidar';
import Crypto from 'node:crypto'
import boxComment from '@djleehaha/boxcomments';


type GenericAbstractConstructor<T> = abstract new (...args: any[]) => T;
type AbstractConstructor = abstract new (...args: any[]) => any;
type Specialisation<T> = {
    constr: T;
    srcFileName: string;
    exportName: string;
};
class FactoryBuilder<T> extends Set<Specialisation<T>>{

    constructor(private baseClass: GenericAbstractConstructor<T>, public outFile: string, private discriminatingProperty: string = 'typeName') {
        super();
    }
    async generate(reason: string) {
        console.log(`\x1B[0m${FS.existsSync(this.outFile) ? 'Reg' : 'G'}enerating \x1B[35m${this.baseClass.name}\x1B[0m factory because ${reason}`);
        const printer = TypeScript.createPrinter({ newLine: TypeScript.NewLineKind.LineFeed, omitTrailingSemicolon: true });
        const sourceFile = TypeScript.createSourceFile(`dummy.ts`, ``, TypeScript.ScriptTarget.Latest, false, TypeScript.ScriptKind.TS);
        const out = FS.createWriteStream(this.outFile, 'utf8');
        out.write(await this.generateOpeningComment());
        out.write('\n');
        const typeNames = new Map<string, Specialisation<T>[]>();
        for (const specialisation of this) {
            const typeName = (specialisation.constr as any)[this.discriminatingProperty];
            if (!typeNames.has(typeName)) {
                typeNames.set(typeName, []);
            }
            typeNames.get(typeName)?.push(specialisation);
        }
        for (const [typeName, specialisations] of typeNames) {
            if (specialisations.length > 1) {
                console.warn(`\x1B[33mWARNING\x1B[0m - Multiple classes use the same value for \x1B[35m${this.discriminatingProperty} \x1B[0m(\x1B[33m${typeName}\x1B[0m).
          References found: ${(await Promise.all(specialisations.map(f => formatFunctionSrcLocation(f.constr as Function)))).join('\n                            ')}`);
            }
        }
        const uniqueNames = new Map<Specialisation<T>, string>();
        for (const specialisation of this) {
            uniqueNames.set(specialisation, `cls_${hash(specialisation.srcFileName, specialisation.exportName)}`);
        }
        const imports = this.generateImports(uniqueNames);
        const typeMappings = this.generateTypeMappings(uniqueNames);
        const typeMappingsType = this.generateTypeMappingsType();
        const cls = this.generateFactoryClass();
        const err = this.generateErrorClass();
        for await (const node of flatAsyncIterables<TypeScript.Node>(imports, typeMappings, typeMappingsType, cls, err)) {
            out.write(printer.printNode(TypeScript.EmitHint.Unspecified, node, sourceFile));
            out.write(';\n');
        }
        out.end();
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
                TypeScript.factory.createIdentifier(uniqueName)
            );
        });

        return TypeScript.factory.createVariableDeclarationList([ // const
            TypeScript.factory.createVariableDeclaration( // typeMappings =
                    /*name*/ `typeMappings`,
                    /*exclamationToken*/ undefined,
                    /* type */ undefined,
                TypeScript.factory.createAsExpression( // as const
                    TypeScript.factory.createObjectLiteralExpression(
                        /*properties*/ propertyAssignments,
                        /*multiline*/ true
                    ),
                    TypeScript.factory.createTypeReferenceNode(`const`)
                ),
            )
        ], TypeScript.NodeFlags.Const);
    }
    private generateTypeMappingsType(): TypeScript.Node {
        return TypeScript.factory.createTypeAliasDeclaration(
            /* modifiers*/[TypeScript.factory.createModifier(TypeScript.SyntaxKind.ExportKeyword)],
            /* name */ TypeScript.factory.createIdentifier(`Specialisation`),
            /* TypeParameters*/ undefined,
            /* type  */ TypeScript.factory.createTypeOperatorNode(
            TypeScript.SyntaxKind.KeyOfKeyword,
            TypeScript.factory.createTypeReferenceNode(
                TypeScript.factory.createIdentifier(`typeof typeMappings`)
            ))
        );
    }
    private generateErrorClass(): TypeScript.Node {
        return TypeScript.factory.createClassDeclaration(
            /* modifiers*/[TypeScript.factory.createModifier(TypeScript.SyntaxKind.ExportKeyword)],
            /*name*/ `${this.baseClass.name}FactoryCreateError`,
            /*type Parameters */ undefined,
            /* heritageClauses */[TypeScript.factory.createHeritageClause(
            TypeScript.SyntaxKind.ExtendsKeyword,
            [
                TypeScript.factory.createExpressionWithTypeArguments(
                    TypeScript.factory.createIdentifier(`Error`),
                    undefined
                )
            ])],
            /*members*/[]
        );
    }

    private generateFactoryClass(): TypeScript.Node {
        const extractConstructorToVariable = TypeScript.factory.createVariableStatement(
            /*modifiers*/[],
            TypeScript.factory.createVariableDeclarationList(
                /* declarations */[
                    TypeScript.factory.createVariableDeclaration(
                        /*name*/ `constr`,
                        /* exclamationToken*/ undefined,
                        /* type */ undefined,
                        TypeScript.factory.createElementAccessExpression(
                            TypeScript.factory.createIdentifier(`typeMappings`),
                            TypeScript.factory.createIdentifier(this.discriminatingProperty)
                        ))
                ],
                TypeScript.NodeFlags.Const)
        );
        const errorMessage = TypeScript.factory.createTemplateExpression(
            TypeScript.factory.createTemplateHead(``),
            [
                TypeScript.factory.createTemplateSpan(TypeScript.factory.createIdentifier(this.discriminatingProperty), TypeScript.factory.createTemplateTail(` is not a valid value for ${this.discriminatingProperty}`)),
            ]);
        const checkForConstructorFound = TypeScript.factory.createIfStatement(
            TypeScript.factory.createPrefixUnaryExpression(TypeScript.SyntaxKind.ExclamationToken, TypeScript.factory.createIdentifier(`constr`)),
            TypeScript.factory.createBlock([
                TypeScript.factory.createThrowStatement(
                    TypeScript.factory.createNewExpression(
                        TypeScript.factory.createIdentifier(`${this.baseClass.name}FactoryCreateError`),
                        undefined,
                        [errorMessage]
                    )
                )
            ]));
        const declareConstructorType = TypeScript.factory.createTypeAliasDeclaration(
            [],
            `SpreadConstructor`, undefined, TypeScript.factory.createTypeLiteralNode(
                [TypeScript.factory.createConstructSignature(
                    undefined,
                    [TypeScript.factory.createParameterDeclaration(
                        undefined,
                        TypeScript.factory.createToken(TypeScript.SyntaxKind.DotDotDotToken),
                        `args`,
                        undefined,
                        TypeScript.factory.createArrayTypeNode(TypeScript.factory.createKeywordTypeNode(TypeScript.SyntaxKind.AnyKeyword)),
                        undefined
                    )],
                    TypeScript.factory.createTypeReferenceNode(this.baseClass.name, undefined)
                )])
        );
        const body = TypeScript.factory.createBlock(
            /*statements*/[
                extractConstructorToVariable,
                checkForConstructorFound,
                TypeScript.addSyntheticLeadingComment(
                    TypeScript.addSyntheticLeadingComment(
                        TypeScript.addSyntheticLeadingComment(declareConstructorType
                            , TypeScript.SyntaxKind.SingleLineCommentTrivia, ` Typescript does not allow using spread when the parameters are know (and are not spread). `)
                        , TypeScript.SyntaxKind.SingleLineCommentTrivia, ` But the FactoryGenerator code generating this function does not know the parameters!`)
                    , TypeScript.SyntaxKind.SingleLineCommentTrivia, ` Hence we need to cast the constructor to something that uses spread parameters`),
                TypeScript.factory.createReturnStatement(
                    TypeScript.factory.createNewExpression(
                    /*expression*/ TypeScript.factory.createAsExpression(TypeScript.factory.createAsExpression(TypeScript.factory.createIdentifier(`constr`), TypeScript.factory.createTypeReferenceNode('unknown')), TypeScript.factory.createTypeReferenceNode('SpreadConstructor')),
                    /*typeArguments*/ undefined,
                    /*argumentsArray*/[
                            TypeScript.factory.createSpreadElement(
                                TypeScript.factory.createIdentifier('init')
                            )
                        ]
                    )
                )
            ], true
        )
        return TypeScript.factory.createClassDeclaration(
            /* modifiers*/[TypeScript.factory.createModifier(TypeScript.SyntaxKind.ExportKeyword)],
            /* name */ `${this.baseClass.name}Factory`,
            /* type parameters */ undefined,
            /* heritageClauses */ undefined,
            /* members */[
                TypeScript.factory.createMethodDeclaration(
                    /*modifiers*/[TypeScript.factory.createModifier(
                    TypeScript.SyntaxKind.StaticKeyword
                )],
                    /*asteriskToken*/ undefined,
                    /* name */ `create`,
                    /*questionToken */ undefined,
                    /*typeParameters*/  undefined,
                    /* parameters */[
                        TypeScript.factory.createParameterDeclaration(
                            /* modifiers*/ undefined,
                            /*dotDotDotToken*/ undefined,
                            /*name*/ this.discriminatingProperty,
                            /*questionToken*/ undefined,
                            /*type*/TypeScript.factory.createTypeReferenceNode(`Specialisation`),
                            /*initializer*/ undefined
                        ),
                        TypeScript.factory.createParameterDeclaration(
                            /* modifiers*/ undefined,
                            /*dotDotDotToken*/ TypeScript.factory.createToken(TypeScript.SyntaxKind.DotDotDotToken),
                            /*name*/ `init`,
                            /*questionToken*/ undefined,
                            /*type*/TypeScript.factory.createTypeReferenceNode(`any[]`),
                            /*initializer*/ undefined
                        ),
                    ],
                    /*type*/ TypeScript.factory.createTypeReferenceNode(this.baseClass.name),
                    body
                )
            ])
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
        yield TypeScript.factory.createImportDeclaration(
            undefined,
            TypeScript.factory.createImportClause(
                false,
                undefined,
                TypeScript.factory.createNamedImports([
                    TypeScript.factory.createImportSpecifier(
                        false,
                        undefined,
                        TypeScript.factory.createIdentifier(this.baseClass.name),
                    )
                ])
            ),
            TypeScript.factory.createStringLiteral(importPath));
        for await (const specialisation of this) { // .deDupe()) {
            // console.log(specialisation);
            if (!(this.discriminatingProperty in (specialisation.constr as any))) {
                console.error(`\x1B[31mERROR\x1B[0m: ${await formatFunctionSrcLocation(specialisation.constr as Function)}\x1B[0m - \x1B[35m${specialisation.exportName}\x1B[0m is missing discriminating property ${this.discriminatingProperty}`);
            }
            if (typeof (specialisation.constr as any)[this.discriminatingProperty] !== 'string') {
                console.error(`\x1B[31mERROR\x1B[0m: ${await formatFunctionSrcLocation(specialisation.constr as Function)}\x1B[0m - \x1B[35m${specialisation.exportName}\x1B[0m's discriminating property ${this.discriminatingProperty} is not a string`);
            }
            const uniqueName = uniqueNames.get(specialisation)!;
            yield TypeScript.factory.createImportDeclaration(
                undefined,
                TypeScript.factory.createImportClause(
                    false,
                    undefined,
                    TypeScript.factory.createNamedImports([
                        TypeScript.factory.createImportSpecifier(
                            false,
                            TypeScript.factory.createIdentifier(specialisation.exportName),
                            TypeScript.factory.createIdentifier(uniqueName)
                        )
                    ])
                ),
                TypeScript.factory.createStringLiteral(Path.relative(Path.dirname(this.outFile), specialisation.srcFileName.replace('dist', 'src')))
            );
        }
    }

    // async *deDupe(): AsyncGenerator<Specialisation<T>, void, unknown> {
    //     const found = new Map<string, Specialisation<T>[]>();
    //     for (const { constr, srcFileName, exportName } of this) {
    //         if (!found.has(exportName)) {
    //             found.set(exportName, [{ constr, srcFileName, exportName }]);

    //         } else {
    //             found.get(exportName)!.push({ constr, srcFileName, exportName });
    //         }
    //     }
    //     for (const [className, funcs] of found) {
    //         if (funcs.length > 1) {
    //             console.warn(`\x1B[33mWARNING\x1B[0m - Multiple classes have the name \x1B[35m${className}\x1B[0m, only the first will be used.
    //       References found: ${(await Promise.all(funcs.map(f => formatFunctionSrcLocation(f.constr as Function)))).join('\n                            ')}`);
    //         }

    //         yield funcs[0];
    //     }
    // }
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
    static #factoryBuilders: Map<Function, FactoryBuilder<Function>> = new Map();

    static createFactoryBuilder<T>(baseClass: GenericAbstractConstructor<T>, outFile: string, discriminatingProperty: string = 'typeName') {
        if (this.isRunning) {
            console.warn(`\x1B[33m WARNING\x1B[0m: Adding a new FactoryBuilder after calling \x1B[35m.run\x1B[0m will not scan for existing files.`);
        }
        const builder = new FactoryBuilder(baseClass, outFile, discriminatingProperty);
        this.#factoryBuilders.set(baseClass, builder as FactoryBuilder<Function>);
    }
    static #isFactoryBuilderOutputFile(modulePath: string) {
        for (const factoryBuilder of this.#factoryBuilders.values()) {
            if (Path.resolve(modulePath) === Path.resolve(factoryBuilder.outFile)) {
                return true;
            } else if (FS.existsSync(`${modulePath}.map`)) {
                const sourceMap = JSON.parse(FS.readFileSync(`${modulePath}.map`, 'utf8'));
                for (const source of sourceMap.sources) {
                    if (Path.resolve(Path.dirname(modulePath), source) === Path.resolve(factoryBuilder.outFile)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    static async #loadModule(modulePath: string): Promise<any> {
        try {
            // console.log(`\x1B[90mLoading module:`, modulePath);
            return await import(`${modulePath}?${new Date().valueOf()}`);
        } catch (ex) {
            console.log(`\x1B[33mWARNING\x1B[0m - Could not load module \x1B[0m ${modulePath}: ${(ex as Error).message} `)
            // throw new Error(`Error while loading module ${modulePath}: ${(ex as Error).message}`);
        }
    }
    static isRunning: boolean = false;
    static async run(srcPath: string, { ignorePaths }: runPropertyBag) {
        if (this.isRunning) {
            return;
        }
        this.isRunning = true;

        console.log(`Looking for src files in ${srcPath}`);
        await FactoriesBuilder.scan(srcPath, ignorePaths);
        const watcher = Chokidar.watch(
            Path.resolve(srcPath),
            { persistent: true, ignoreInitial: true }
        );
        async function considerChangedFile(type: string, path: string) {
            if (FactoriesBuilder.isPathIgnored(path, ignorePaths)) {
                return;
            };
            if (path && ['.js', '.mjs'].includes(Path.extname(path))) {
                // console.log(`\x1B[34m ${type} \x1B[0m ${path}`);
                for (const builder of await FactoriesBuilder.considerFile(path, ignorePaths)) {
                    await builder.generate(`\x1B[34m${path}\x1B[0m was written to`);
                }
            }
        }

        watcher.on('add', path => considerChangedFile('add', path));
        watcher.on('change', path => considerChangedFile('change', path));
        //TODO: Handle deletes and errors
        for (const builder of FactoriesBuilder.#factoryBuilders.values()) {
            await builder.generate(`Initial build`);
        }



    }
    static isPathIgnored(path: string, ignorePaths: string[]): boolean {
        for (const ignorePath of ignorePaths) {
            // console.log('ignore?', Path.relative(Path.resolve(ignorePath), Path.resolve(path)), path, ignorePath);
            if (!Path.relative(Path.resolve(ignorePath), Path.resolve(path)).startsWith('../')) {
                // console.log(`ignoring file ${path}`);
                return true;
            }
        }
        return false;
    }
    static async considerFile(modulePath: string, ignoredPaths: string[]): Promise<Iterable<FactoryBuilder<Function>>> {

        const affectedBuilders = new Set<FactoryBuilder<Function>>();
        for (const builder of this.#factoryBuilders.values()) {
            if (builder.removeExistingFileReferences(modulePath)) {
                affectedBuilders.add(builder);
            }
        }
        if (Path.resolve(modulePath) === Path.resolve(import.meta.filename)) {
            return []; // don't try to load this file!
        }
        if (this.#isFactoryBuilderOutputFile(modulePath)) {
            return []; // don't try to load this file!
        }
        if (FactoriesBuilder.isPathIgnored(modulePath, ignoredPaths)) {
            return [];
        }
        const module = await this.#loadModule(modulePath);
        if (!module) {
            return [];
        }
        for (const [exportName, exported] of Object.entries(module)) {
            for (const [baseClass, builder] of this.#factoryBuilders) {
                if ((typeof exported) !== 'function') {
                    continue;
                }
                if (typeof exported === 'function' && exported.prototype instanceof baseClass) { // repeating the typeof check is not required at runtime, but it helps typescript infer types
                    // console.log('FFF', modulePath, exportName, exported, baseClass, baseClass.prototype.isPrototypeOf(exported.prototype));
                    // console.log(file.name, exportName, exported);
                    builder.add({
                        srcFileName: Path.resolve(modulePath),
                        exportName: exportName,
                        constr: exported
                    });
                    affectedBuilders.add(builder);
                } else if (typeof exported === 'function') {
                    // walk the prototype chain to check for inheritance that matches the base class's name and emit a warning about it
                    let proto = Object.getPrototypeOf(exported);
                    while (proto && proto !== Function.prototype) {
                        if (proto.name === baseClass.name) {

                            console.warn(`\x1B[33mWARNING\x1B[0m - ${await formatFunctionSrcLocation(exported)}\x1B[0m - class \x1B[35m${exportName}\x1B[0m inherits from a class called \x1B[35m${proto.name}\x1B[0m(${await formatFunctionSrcLocation(proto)}\x1B[0m) but this does not appear to be the same class as \x1B[35m${baseClass.name}\x1B[0m(${await formatFunctionSrcLocation(baseClass)}\x1B[0m)
Possible causes:
1. \x1B[35m${exportName}\x1B[0m is defined in the same file as \x1B[35m${baseClass.name}\x1B[0m - This is, unfortunately, not supported for complex reasons to do with dynamic import, cache validation and the change tracking feature of this application.
2. There genuinely is more than 1 \x1B[35m${proto.name}\x1B[0m class and \x1B[35m${exportName}\x1B[0m is derived from the other one. If this is intentional then this warning can be ignored.\x1B[0m`);
                        }
                        proto = Object.getPrototypeOf(proto);  // Move up the chain                        }
                    }
                }
            }
        }
        return affectedBuilders.values();
    }
    private static async scan(path: string, ignoredPaths: string[]) {

        const files = FS.readdirSync(path, { withFileTypes: true, recursive: true }).filter(f => f.isFile() && ['.js', '.mjs'].includes(Path.extname(f.name)));
        for (const file of files) {

            const modulePath = Path.join(file.parentPath, file.name);
            await FactoriesBuilder.considerFile(modulePath, ignoredPaths);
        }
    }
}

async function formatFunctionSrcLocation(func: Function, ansi: boolean = true) {
    const srcLocation = await getMappedFunctionLocation(func);
    const relativePath = Path.relative(".", srcLocation.filename);
    if (ansi) {
        return `\x1B[36m${relativePath}:\x1B[93m${srcLocation.line}\x1B[0m:\x1B[93m${srcLocation.col}`;
    } else {
        return `${relativePath}:${srcLocation.line}:${srcLocation.col}`;
    }
}

function hash(...strings: string[]) {
    const hash = Crypto.createHash('sha1');
    for (const str of strings) {
        hash.update(str);
    }
    return hash.digest('hex'); // TODO: consider using a different hashing algorithm here
}


async function* flatAsyncIterables<T>(...iterables: (AsyncIterable<T> | Iterable<T> | T)[]): AsyncGenerator<T> {
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
}
