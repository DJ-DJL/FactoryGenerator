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
import MyBaseType from './dist/MyBaseType.js';

FactoriesBuilder.createFactoryBuilder(
    MyBaseType,
    Path.resolve('.', 'src/factories/MyBaseTypeFactory.ts')
);
await FactoriesBuilder.run(Path.resolve('.', 'dist'));
```

The factory generator will scan your _javascript_ code (in the example looking only in the `dist` folder) for types that derive from your base class (`MyBaseType` in the example) and generate a Factory class in the specified location (`src/factories/MyBaseTypeFactory.ts` in the example) as typescript.

The generated class has a single static method: `create` with parameters:
* The first parameter takes a string which should match the `typeName` static property of one of the specialisations
* and `...init` parameters to be passed on to the constructor.

~~FactoryGenerator will then watch for new and modified files and regenerate the factory class if required. (removed)~~

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

FactoriesBuilder.createFactoryBuilder(
    MyBaseClass,
    Path.resolve('.', 'src/factories/MyBaseClassFactory.ts')
);
await FactoriesBuilder.run(Path.resolve('.', 'dist'));
```

Do not include `build/factories.js` in your run-time code, only your build-time code!

## Automatic running

If you use VisualStudioCode you may wish to consider setting up a task to run the FactoryBuilder automatically.

Create a tasks.json file if you don't already have one:
* Ctrl+Shift+P
* Select "Tasks: Configure Tasks"
![Select "Configure Tasks" menu entry](https://s3.eu-north-1.amazonaws.com/cv.leesmith.dev/readmeimages/ConfigureTask.png)
* Select "Create tasks.json file from template"
![Select "Create tasks.json" menu entry](https://s3.eu-north-1.amazonaws.com/cv.leesmith.dev/readmeimages/Create+Tasksjson+With+Template.png)
* Select "Others"
![Select "Others" menu entry](https://s3.eu-north-1.amazonaws.com/cv.leesmith.dev/readmeimages/Others.png)

Create the task as follows:
```
{
    "type": "shell",
    "command": "node",
    "args": ["dist/build/factories.js"],
    "label": "Build factories",
    "runOptions": {
        "reevaluateOnRerun": true,
        "runOn": "folderOpen"
    }
}
```
Being sure to replace the arg with the path to the entry point you created.

Then set permission for the task to run automatically when you open the folder

* Ctrl+Shift+P
* Select "Tasks: Manage Automatic Tasks"
![Select "Tasks: Manage Automatic Tasks" menu entry](https://s3.eu-north-1.amazonaws.com/cv.leesmith.dev/readmeimages/ManageAutomaticTasks.png)
* Select "Allow Automatic Tasks"
![Select "Allow Automatic Tasks" menu entry](https://s3.eu-north-1.amazonaws.com/cv.leesmith.dev/readmeimages/AllowAutomaticTasks.png)

Before you enable automatic tasks it is recommended to review the list of tasks with `"runOn": "folderOpen"` to ensure it's not going to run something you don't want!

Now restart visual studio code (Ctrl+Shift+P -> Developer: Reload Window)

You can see the output from the FactoryGenerator in the Terminal tab

![image](https://s3.eu-north-1.amazonaws.com/cv.leesmith.dev/readmeimages/Output.png)

## Important notes

The usage of this module is a confusing mix of javascript and typescript.
In particular: the FactoriesBuilder requires compiled _javascript_ files as it's input, but generates _typescript_ (that must then be compiled to javascript along with the rest of your code)
(TODO: Enable outputting directly to javascript)

## Known issues

There are probably many bugs resulting from my assumptions that your repository is laid out similarly to mine (i.e. with typescript files in a `src` directory and compiled javascript files in a `dist` director ).

I haven't (yet) tested this module with alternative repository layouts.

## Contributing

Please create a pull request for any bugs or enhancements

## License

This project is licensed under the MIT License.

<style>
image {
    display: block;
}
    </style>
