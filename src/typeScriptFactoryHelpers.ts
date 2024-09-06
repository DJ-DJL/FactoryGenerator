import TypeScript from 'typescript';

export const cast = TypeScript.factory.createAsExpression.bind(TypeScript.factory);
export const id = TypeScript.factory.createIdentifier.bind(TypeScript.factory);
export const typeRef = TypeScript.factory.createTypeReferenceNode.bind(TypeScript.factory);
export const spread = TypeScript.factory.createSpreadElement.bind(TypeScript.factory);
export function keyOf(type: TypeScript.TypeNode) {
    return TypeScript.factory.createTypeOperatorNode(TypeScript.SyntaxKind.KeyOfKeyword, type);
}
export function exportKeyword() {
    return TypeScript.factory.createModifier(TypeScript.SyntaxKind.ExportKeyword);
}
export function extend(...bases: string[]) {
    return TypeScript.factory.createHeritageClause(
        TypeScript.SyntaxKind.ExtendsKeyword,
        bases.map(base =>
            TypeScript.factory.createExpressionWithTypeArguments(
                id(base),
                undefined
            )
        ));
}
export function mkStaticFunction(name: string, parameters: TypeScript.ParameterDeclaration[], returnType: TypeScript.TypeReferenceNode, body: TypeScript.Block) {
    const modifiers = [TypeScript.factory.createModifier(TypeScript.SyntaxKind.StaticKeyword)];
    return TypeScript.factory.createMethodDeclaration(
        modifiers,
        /*asteriskToken*/ undefined,
        name,
        /*questionToken */ undefined,
        /*typeParameters*/ undefined,
        parameters,
        /*type*/ returnType,
        body
    );
}


export function mkParam(name: string, type: string, spread?: boolean): TypeScript.ParameterDeclaration;
export function mkParam(name: string, type: TypeScript.TypeNode, spread?: boolean): TypeScript.ParameterDeclaration;
export function mkParam(name: string, type: string | TypeScript.TypeNode, spread: boolean = false): TypeScript.ParameterDeclaration {
    if (typeof type === 'string') {
        type = typeRef(type);
    }
    return TypeScript.factory.createParameterDeclaration(
    /*modifiers*/ undefined,
    /*dotDotDotToken*/ spread ? TypeScript.factory.createToken(TypeScript.SyntaxKind.DotDotDotToken) : undefined,
    /*name*/ name,
    /*questionToken*/ undefined,
    /*type*/ type,
    /*initializer*/ undefined
    );
}
export function blockCommentBefore<T extends TypeScript.Node>(comment: string, statement: T): T {
    return TypeScript.addSyntheticLeadingComment(
        statement,
        TypeScript.SyntaxKind.MultiLineCommentTrivia,
        comment,
        true
    );
}


type TypeAsserter<T> = (param: any, source: string) => asserts param is T;
function verifyAlternatingTypes<T, U>(validateT: TypeAsserter<T>, validateU: TypeAsserter<U>, params: any[], functionName?: string): [T[], U[]] {
    const ofFunctionName = functionName ? `of ${functionName} ` : ``;
    const outT: T[] = [];
    const outU: U[] = [];
    for (let idx = 0; idx < params.length; idx++) {
        const item = params[idx];
        if (idx % 2 === 0) {
            validateT(item, `Arg ${idx} ${ofFunctionName}`);
            outT.push(item);
        }
        else {
            validateU(item, `Arg ${idx} ${ofFunctionName}`);
            outU.push(item);
        }
    }
    return [outT, outU];
}



export function mkTemplateLiteral(...args: (string | TypeScript.Expression)[]): TypeScript.TemplateLiteral {
    const isString: TypeAsserter<string> = (param, source) => {
        if (typeof param !== 'string') {
            throw new Error(`${source} must be string`);
        }
    }
    const isExpression: TypeAsserter<TypeScript.Node> = (param, source) => {
        if (!TypeScript.isExpression(param as TypeScript.Node)) {
            throw new Error(`${source} must be an instance of TypeScript.Expression`);
        }
    }
    const [strings, spans] = verifyAlternatingTypes<string, TypeScript.Expression>(isString, isExpression, args, `mkTemplateLiteral`);
    while (strings.length < spans.length + 1) {
        strings.push(``);
    }
    if (spans.length === 0) {
        return TypeScript.factory.createNoSubstitutionTemplateLiteral(strings[0] ?? "")
    }
    return TypeScript.factory.createTemplateExpression(
        TypeScript.factory.createTemplateHead(strings[0]),
        spans.map((span, idx) => {
            const isLast = idx === spans.length - 1;
            return TypeScript.factory.createTemplateSpan(span, mkTailOrMiddle(isLast, strings[idx + 1]))
        })
    );

    function mkTailOrMiddle(tail: boolean, value: string) {
        if (tail) {
            return TypeScript.factory.createTemplateTail(value)
        }
        return TypeScript.factory.createTemplateMiddle(value)
    }
}
/*
// tests for mkTemplateLiteral
function testPrint(node: TypeScript.Node) {
    const printer = TypeScript.createPrinter({ newLine: TypeScript.NewLineKind.LineFeed, omitTrailingSemicolon: true });
    const sourceFile = TypeScript.createSourceFile(`dummy.ts`, ``, TypeScript.ScriptTarget.Latest, false, TypeScript.ScriptKind.TS);
    return printer.printNode(TypeScript.EmitHint.Unspecified, node, sourceFile);
}

console.log(testPrint(mkTemplateLiteral(`a`)));
console.log(testPrint(mkTemplateLiteral(`b`, id('c'))));
console.log(testPrint(mkTemplateLiteral(`d`, id('e'), 'f')));
console.log(testPrint(mkTemplateLiteral(`g`, id('h'), 'i', id('j'))));
console.log(testPrint(mkTemplateLiteral(`k`, id('l'), 'm', id('n'), 'o')));
// console.log(testPrint(mkTemplateLiteral(`p`, 'q'))); // throws
// console.log(testPrint(mkTemplateLiteral(id(`r`), 's'))); // throws
*/
