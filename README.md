# Factory Generator


## Description

build-time module to generate typescript factory classes

To install the module, use npm:

```bash
npm install --save-dev @djleehaha/factorygenerator
```
## Usage

First, create your base class and at least one specialisation.
Each of your specialisations must have a static property that indicates the type (by default this property is named `typeName`, but you can customise this)

```javascript
import FactoriesBuilder from '@djleehaha/factorygenerator';
import MyBaseType from './some/path.js';

FactoriesBuilder.createFactoryBuilder(MyBaseType, Path.resolve('.', 'src/factories/MyBaseTypeFactory.ts'));
await FactoriesBuilder.run(Path.resolve('.', 'dist'));
```

The factory generator will scan your _javascript_ code (in the example looking only in the `dist` folder) for types that derive from your base class (`MyBaseType` in the example) and generate a Factory class in the specified location (`src/factories/MyBaseTypeFactory.ts` in the example) as typescript.

The generated class has a single static method: `create` with parameters:
* The first parameter takes a string which should match the `typeName` static property of one of the specialisations
* and `...init` parameters to be passed on to the constructor.
FactoryGenerator will then watch for new and modified files and regenerate the factory class if required.

## Complete Example:

File: `MyBaseType.js`
```javascript
export default class MyBaseType
{
    ...
}
```

File: `Specialisations.js`
```javascript
import MyBaseType from './MyBaseType.js';
export class MySpecialisation1 extends MyBaseType
{
    static typeName = 'Specialisation1'
    ...
}
export class MySpecialisation2 extends MyBaseType
{
    static typeName = 'Specialisation2'
    ...
}
```

File: `build/factories.js`

```javascript
import FactoriesBuilder from '@djleehaha/factorygenerator';
import MyBaseClass from '../MyBaseClass.js';
import Path from 'path';

FactoriesBuilder.createFactoryBuilder(DBTreeItem, Path.resolve('.', 'src/factories/DBTreeItemFactory.ts'));
await FactoriesBuilder.run(Path.resolve('.', 'dist'));
```

Do not include `build/factories.js` in your run-time code, only your build-time code!

## Important notes

The usage of this module is a confusing mix of javascript and typescript.
In particular: the FactoriesBuilder requires compiled _javascript_ files as it's input, but generates _typescript_ (that must then be compiled to javascript along with the rest of your code) (TODO: Enable outputting directly to javascript)

## Known issues

There are probably many bugs resulting from my assumptions that your repository is laid out similarly to mine (i.e. with typescript files in a `src` directory and compiled javascript files in a `dist` director )
I haven't (yet) tested this module with alternative repository layouts.

## Contributing

Please create a pull request for any bugs or enhancements

## License

This project is licensed under the MIT License.
