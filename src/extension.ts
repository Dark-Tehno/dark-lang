import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Мы будем управлять одним экземпляром терминала для всех запусков
let darkTerminal: vscode.Terminal | undefined;

// --- Новые глобальные переменные для управления denv ---
let denvStatusBarItem: vscode.StatusBarItem;
const DENV_CONFIG_FILE = 'denv.cfg';

// Эта функция находит существующий терминал или создает новый
function getDarkTerminal(): vscode.Terminal {
    if (darkTerminal && darkTerminal.exitStatus === undefined) {
        return darkTerminal;
    }
    darkTerminal = vscode.window.createTerminal(`Dark Runner`);
    return darkTerminal;
}

// --- Новые функции для работы с denv ---

/**
 * Находит все denv окружения в рабочей области.
 */
async function findDenvs(): Promise<vscode.Uri[]> {
    const denvUris: vscode.Uri[] = [];
    if (!vscode.workspace.workspaceFolders) {
        return [];
    }

    for (const folder of vscode.workspace.workspaceFolders) {
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `**/${DENV_CONFIG_FILE}`), '**/node_modules/**', 100);
        for (const file of files) {
            denvUris.push(vscode.Uri.joinPath(file, '..'));
        }
    }
    return denvUris;
}

/**
 * Обновляет текст в строке состояния, отображая выбранное окружение.
 */
function updateStatusBar(context: vscode.ExtensionContext) {
    const selectedDenvPath = context.workspaceState.get<string>('selectedDenvPath');
    if (selectedDenvPath) {
        const denvName = path.basename(selectedDenvPath);
        denvStatusBarItem.text = `$(folder-active) Dark: ${denvName}`;
        denvStatusBarItem.tooltip = `Активное окружение Dark: ${selectedDenvPath}`;
    } else {
        denvStatusBarItem.text = `$(error) Dark: Выбрать окружение`;
        denvStatusBarItem.tooltip = 'Окружение Dark (denv) не выбрано';
    }
    denvStatusBarItem.show();
}

/**
 * Регистрирует команду для выбора denv.
 */
function registerDenvSelectorCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('dark.selectDenv', async () => {
        const denvs = await findDenvs();
        if (denvs.length === 0) {
            vscode.window.showInformationMessage('Окружения Dark (denv) не найдены в рабочей области.');
            return;
        }

        const quickPickItems = denvs.map(uri => ({
            label: path.basename(uri.fsPath),
            description: uri.fsPath,
            uri: uri
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Выберите окружение Dark (denv)'
        });

        if (selected) {
            await context.workspaceState.update('selectedDenvPath', selected.uri.fsPath);
            updateStatusBar(context);
            vscode.window.showInformationMessage(`Окружение Dark '${selected.label}' выбрано.`);
        }
    });
    context.subscriptions.push(command);
}

// --- НОВЫЙ, УЛУЧШЕННЫЙ АНАЛИЗАТОР КОДА ---

/** Кэш для хранения результата анализа, чтобы не парсить файл заново при каждом действии */
let lastAnalyzedDocVersion: number | undefined;
let lastAnalysis: AnalyzedDocument | undefined;

/** Описывает найденную переменную */
interface AnalyzedVariable {
    name: string;
    type?: string; // Добавляем тип для глобальных переменных
}

/** Описывает найденный класс */
interface AnalyzedClass {
    name: string;
    parent?: string;
    methods: AnalyzedFunction[];
    properties: AnalyzedVariable[];
    startLine: number;
    endLine: number;
}

/** Описывает найденную функцию со всеми ее деталями */
interface AnalyzedFunction {
    name: string;
    parameters: AnalyzedVariable[];
    variables: AnalyzedVariable[];
    startLine: number;
    endLine: number;
    detail: string;
    documentation: string;
    snippet: vscode.SnippetString;
}

/**
 * Хранит полную структуру проанализированного документа
 */
interface AnalyzedDocument {
    globals: AnalyzedVariable[];
    functions: AnalyzedFunction[];
    classes: AnalyzedClass[];
    imports: AnalyzedVariable[];
    usedImports: AnalyzedVariable[];
}

/** Описывает импорт через `from ... use ...` */
interface AnalyzedFromImport {
    modulePath: string;
    names: string[];
    line: number;
}
/**
 * Находит соответствующий 'end' для блока, начинающегося на startLine,
 * корректно обрабатывая вложенные блоки.
 */
function findMatchingEnd(document: vscode.TextDocument, startLine: number): number {
    let blockDepth = 1;
    const blockStarters = /^\s*(if|while|for|function|class|try)\b/;
    const blockEnder = /^\s*(end|except)\b/;

    for (let i = startLine + 1; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        if (blockStarters.test(lineText)) {
            blockDepth++;
        } else if (blockEnder.test(lineText)) {
            blockDepth--;
            if (blockDepth === 0) {
                return i; // Нашли соответствующий 'end'
            }
        }
    }
    return document.lineCount - 1; // Если не нашли, считаем концом файла
}

/**
 * Главная функция-анализатор. Сканирует документ и извлекает его структуру.
 */
function analyzeDocument(document: vscode.TextDocument): AnalyzedDocument {
    const text = document.getText();
    const lines = text.split('\n');
    
    const analyzedFunctions: AnalyzedFunction[] = [];
    const analyzedClasses: AnalyzedClass[] = [];
    const globalVariables: AnalyzedVariable[] = [];
    const imports: AnalyzedVariable[] = [];
    const usedImports: AnalyzedVariable[] = [];
    const fromImports: AnalyzedFromImport[] = [];

    const keywords = ['if', 'then', 'else', 'end', 'while', 'do', 'for', 'in', 'return', 'import', 'function', 'true', 'false', 'try', 'except', 'and', 'or', 'not', 'class', 'from', 'use'];

    const classRegex = /^\s*class\s+([a-zA-Z_]\w*)\s*(?:\(\s*([a-zA-Z_]\w*)\s*\))?/;
    const functionRegex = /^\s*function\s+([a-zA-Z_]\w*)\s*([^\r\n]*)/;
    const variableRegex = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/;
    const classInstantiationRegex = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([a-zA-Z_]\w*)\s*\(/;
    const importRegex = /^\s*import\s*"((?:\\.|[^"\\])*)"/;
    const fromUseRegex = /^\s*from\s*"((?:\\.|[^"\\])*)"\s+use\s+(.*)/;

    const parseFunction = (startLine: number, isMethod: boolean = false, className: string = ''): { func: AnalyzedFunction, end: number } | null => {
        const lineText = lines[startLine];
        const funcMatch = lineText.match(functionRegex);
        if (!funcMatch) return null;

        const endLine = findMatchingEnd(document, startLine);
        const funcName = funcMatch[1];
        let paramsStr = funcMatch[2].trim();

        if (paramsStr.endsWith(' do')) {
            paramsStr = paramsStr.substring(0, paramsStr.length - 3).trim();
        }
        if (paramsStr.startsWith('(') && paramsStr.endsWith(')')) {
            paramsStr = paramsStr.substring(1, paramsStr.length - 1);
        }

        const parameters = paramsStr.split(',').map(p => p.trim()).filter(p => p).map(p => ({ name: p }));
        const parameterNames = new Set(parameters.map(p => p.name));

        const localVariableNames = new Set<string>();
        for (let j = startLine + 1; j < endLine; j++) {
            const bodyLine = lines[j];
            const varMatch = bodyLine.match(variableRegex);
            if (varMatch && !keywords.includes(varMatch[1]) && !parameterNames.has(varMatch[1])) {
                localVariableNames.add(varMatch[1]);
            }
        }
        const localVariables = Array.from(localVariableNames).map(name => ({ name }));

        let documentation = '';
        const signatureEndOffset = document.offsetAt(new vscode.Position(startLine, funcMatch[0].length));
        const textAfterSignature = text.substring(signatureEndOffset);
        const doMatch = /^\s*do/.exec(textAfterSignature);
        if (doMatch) {
            const textAfterDo = textAfterSignature.substring(doMatch[0].length);
            const docstringMatch = /^\s*"((?:\\.|[^"\\])*)"/.exec(textAfterDo);
            if (docstringMatch) {
                documentation = docstringMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t');
            }
        }
        if (!documentation) {
            let currentLineNum = startLine - 1;
            const docstringLines: string[] = [];
            while (currentLineNum >= 0) {
                const line = document.lineAt(currentLineNum);
                const lineTextTrimmed = line.text.trim();
                if (lineTextTrimmed.startsWith('#')) {
                    docstringLines.unshift(lineTextTrimmed.substring(1).trim());
                } else if (lineTextTrimmed.length > 0) {
                    break;
                }
                currentLineNum--;
            }
            documentation = docstringLines.join('\n') || (isMethod ? 'Метод класса.' : 'Пользовательская функция.');
        }

        const detail = `${isMethod ? 'method' : 'function'} ${isMethod ? className + '.' : ''}${funcName}(${parameters.map(p => p.name).join(', ')})`;
        const snippetParams = parameters.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ');
        const snippet = new vscode.SnippetString(`${funcName}(${isMethod && parameters.length > 1 ? snippetParams.substring(snippetParams.indexOf(',') + 1).trim() : snippetParams})`);

        return {
            func: { name: funcName, parameters, variables: localVariables, startLine, endLine, detail, documentation, snippet },
            end: endLine
        };
    };

    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        const classMatch = lineText.match(classRegex);
        if (classMatch) {
            const startLine = i;
            const endLine = findMatchingEnd(document, startLine);
            const methods: AnalyzedFunction[] = [];
            const properties = new Set<string>();

            for (let j = startLine + 1; j < endLine; j++) {
                const methodResult = parseFunction(j, true, classMatch[1]);
                if (methodResult) {
                    methods.push(methodResult.func);

                    // Анализируем тело метода на предмет присваивания свойств (object.prop = ...)
                    if (methodResult.func.parameters.length > 0) {
                        const selfParamName = methodResult.func.parameters[0].name;
                        const propertyRegex = new RegExp(`^\\s*${selfParamName}\\.([a-zA-Z_]\\w*)\\s*=\\s*`);
                        for (let k = methodResult.func.startLine + 1; k < methodResult.func.endLine; k++) {
                            const propMatch = lines[k].match(propertyRegex);
                            if (propMatch) {
                                properties.add(propMatch[1]);
                            }
                        }
                    }
                    j = methodResult.end;
                }
            }
            const analyzedProperties = Array.from(properties).map(name => ({ name }));
            analyzedClasses.push({ name: classMatch[1], parent: classMatch[2], methods, properties: analyzedProperties, startLine, endLine });
            i = endLine;
            continue;
        }

        const funcResult = parseFunction(i);
        if (funcResult) {
            analyzedFunctions.push(funcResult.func);
            i = funcResult.end;
            continue;
        }

        const importMatch = lineText.match(importRegex);
        if (importMatch) {
            imports.push({ name: importMatch[1] });
            continue;
        }

        const fromUseMatch = lineText.match(fromUseRegex);
        if (fromUseMatch) {
            const usedNames = fromUseMatch[2].split(',').map(name => name.trim()).filter(name => name);
            usedNames.forEach(name => {
                // Рассматриваем импортированные имена как глобальные переменные/функции
                usedImports.push({ name: name });
            });
            continue;
        }

        const classInitMatch = lineText.match(classInstantiationRegex);
        if (classInitMatch) {
            const varName = classInitMatch[1];
            const className = classInitMatch[2];
            globalVariables.push({ name: varName, type: className });
            continue;
        }
        const varMatch = lineText.match(variableRegex);
        if (varMatch && !keywords.includes(varMatch[1])) {
            globalVariables.push({ name: varMatch[1] });
        }
    }

    return {
        globals: globalVariables,
        functions: analyzedFunctions,
        classes: analyzedClasses,
        imports: imports,
        usedImports: usedImports,
        // fromImports: fromImports // This was part of a thought process but is not needed if hover provider is async
    };
}

/**
 * Обертка для анализатора с кэшированием.
 */
function getAnalyzedDocument(document: vscode.TextDocument): AnalyzedDocument {
    if (lastAnalyzedDocVersion === document.version && lastAnalysis) {
        return lastAnalysis;
    }
    lastAnalysis = analyzeDocument(document);
    lastAnalyzedDocVersion = document.version;
    return lastAnalysis;
}

const builtInMethods = {
    'string': {
        'len': { detail: 'string.len()', documentation: 'Возвращает количество символов в строке.', snippet: 'len()' },
        'upper': { detail: 'string.upper()', documentation: 'Возвращает новую строку в верхнем регистре.', snippet: 'upper()' },
        'lower': { detail: 'string.lower()', documentation: 'Возвращает новую строку в нижнем регистре.', snippet: 'lower()' },
        'strip': { detail: 'string.strip()', documentation: 'Удаляет пробельные символы в начале и в конце строки.', snippet: 'strip()' },
        'startswith': { detail: 'string.startswith(prefix)', documentation: 'Возвращает `true`, если строка начинается с `prefix`.', snippet: 'startswith("${1:prefix}")' },
        'endswith': { detail: 'string.endswith(suffix)', documentation: 'Возвращает `true`, если строка заканчивается на `suffix`.', snippet: 'endswith("${1:suffix}")' },
        'find': { detail: 'string.find(substring)', documentation: 'Ищет подстроку и возвращает индекс первого вхождения или -1, если не найдено.', snippet: 'find("${1:substring}")' },
    },
    'list': {
        'len': { detail: 'list.len()', documentation: 'Возвращает количество элементов в списке.', snippet: 'len()' },
        'append': { detail: 'list.append(item)', documentation: 'Добавляет элемент в конец списка.', snippet: 'append(${1:item})' },
        'pop': { detail: 'list.pop()', documentation: 'Удаляет и возвращает последний элемент списка.', snippet: 'pop()' },
    },
    'dict': {
        'len': { detail: 'dict.len()', documentation: 'Возвращает количество пар ключ-значение в словаре.', snippet: 'len()' },
        'keys': { detail: 'dict.keys()', documentation: 'Возвращает список всех ключей в словаре.', snippet: 'keys()' },
    }
};

const standardLibrary = {
    'vsp210': {
        'history': { detail: 'vsp210.history()', documentation: 'Возвращает исторю создателя языка Dark.', snippet: 'history()' },
        'philosophy': { detail: 'vsp210.philosophy()', documentation: 'Возвращает философию языка Dark.(Секретная функция)', snippet: 'philosophy()' },
        'calculator': { detail: 'vsp210.calculator()', documentation: 'Запускает калькулятор написаный для примера.', snippet: 'calculator()' },
        'version': { detail: 'vsp210.version()', documentation: 'Возвращает версию языка Dark.', snippet: 'version()' },
        'docs': { detail: 'vsp210.docs()', documentation: 'Отправляет пользователя на страницу документации языка Dark.', snippet: 'docs()' },
        'telegram': { detail: 'vsp210.telegram()', documentation: 'Отправляет пользователя в телеграм канал создателя языка Dark.', snippet: 'telegram()' },
    },
    'http': {
        'get': { detail: 'http.get(url)', documentation: 'Выполняет HTTP GET-запрос и возвращает словарь с `status_code`, `headers` и `body`.', snippet: 'get("${1:url}")' },
    },
    'os': {
        'getcwd': { detail: 'os.getcwd()', documentation: 'Возвращает текущую рабочую директорию.', snippet: 'getcwd()' },
        'path_exists': { detail: 'os.path_exists(path)', documentation: 'Проверяет, существует ли путь. Возвращает True или False.', snippet: 'path_exists("${1:path}")' },
        'mkdir': { detail: 'os.mkdir(path)', documentation: 'Создает директорию.', snippet: 'mkdir("${1:path}")' },
        'rmdir': { detail: 'os.rmdir(path)', documentation: 'Удаляет директорию.', snippet: 'rmdir("${1:path}")' },
        'remove': { detail: 'os.remove(path)', documentation: 'Удаляет файл.', snippet: 'remove("${1:path}")' },
        'rename': { detail: 'os.rename(old, new)', documentation: 'Переименовывает файл или директорию.', snippet: 'rename("${1:old}", "${2:new}")' },
        'listdir': { detail: 'os.listdir(path)', documentation: 'Возвращает список содержимого директории.', snippet: 'listdir("${1:path}")' },
        'getsize': { detail: 'os.getsize(path)', documentation: 'Возвращает размер файла.', snippet: 'getsize("${1:path}")' },
        'isdir': { detail: 'os.isdir(path)', documentation: 'Проверяет, является ли путь директорией.', snippet: 'isdir("${1:path}")' },
        'system': { detail: 'os.system(command)', documentation: 'Выполняет системную команду (например, "cls" или "clear").', snippet: 'system("${1:command}")' },
        'exit': { detail: 'os.exit(code)', documentation: 'Завершает выполнение программы с указанным кодом выхода.', snippet: 'exit(${1:0})' },
    },
    'math': {
        'sqrt': { detail: 'math.sqrt(number)', documentation: 'Вычисляет квадратный корень числа.', snippet: 'sqrt(${1:number})' },
        'pow': { detail: 'math.pow(base, exp)', documentation: 'Вычисляет `base` в степени `exp`.', snippet: 'pow(${1:base}, ${2:exp})' },
        'floor': { detail: 'math.floor(number)', documentation: 'Возвращает наибольшее целое число, меньшее или равное `number`.', snippet: 'floor(${1:number})' },
        'ceil': { detail: 'math.ceil(number)', documentation: 'Возвращает наименьшее целое число, большее или равное `number`.', snippet: 'ceil(${1:number})' },
        'pi': { detail: 'math.pi()', documentation: 'Возвращает значение числа PI.', snippet: 'pi()' },
        'random': { detail: 'math.random()', documentation: 'Возвращает случайное число с плавающей точкой от 0.0 до 1.0.', snippet: 'random()' },
        'random_int': { detail: 'math.random_int(min, max)', documentation: 'Возвращает случайное целое число в диапазоне от `min` до `max` включительно.', snippet: 'random_int(${1:min}, ${2:max})' },
    },
    'stdlib': {
        'range': { detail: 'stdlib.range(start, stop)', documentation: 'Возвращает список чисел в диапазоне от `start` (включительно) до `stop` (не включительно).', snippet: 'range(${1:start}, ${2:stop})' },
        'list_contains': { detail: 'stdlib.list_contains(list, item)', documentation: 'Проверяет, содержится ли `item` в `list`.', snippet: 'list_contains(${1:list}, ${2:item})' },
        'list_join': { detail: 'stdlib.list_join(list, separator)', documentation: 'Объединяет элементы списка в строку с указанным разделителем.', snippet: 'list_join(${1:list}, "${2:separator}")' },
        'dict_get': { detail: 'stdlib.dict_get(dict, key, default)', documentation: 'Получает значение из словаря по ключу, с возможностью указать значение по умолчанию.', snippet: 'dict_get(${1:dict}, ${2:key}, ${3:default})' },
        'clamp': { detail: 'stdlib.clamp(value, min, max)', documentation: 'Ограничивает значение `value` между `min` и `max`.', snippet: 'clamp(${1:value}, ${2:min}, ${3:max})' },
        'json_decode': { detail: 'stdlib.json_decode(json_string)', documentation: 'Преобразует строку в формате JSON в словарь или список.', snippet: 'json_decode(${1:json_string})' },
        'read_file': { detail: 'stdlib.read_file(path)', documentation: 'Читает содержимое файла и возвращает его в виде строки.', snippet: 'read_file("${1:path}")' },
        'write_file': { detail: 'stdlib.write_file(path, content)', documentation: 'Записывает строку `content` в файл по указанному пути `path`.', snippet: 'write_file("${1:path}", ${2:content})' },
        'str_split': { detail: 'stdlib.str_split(string, separator)', documentation: 'Разделяет строку по указанному разделителю и возвращает список.', snippet: 'str_split(${1:string}, "${2:separator}")' },
        'str_upper': { detail: 'stdlib.str_upper(string)', documentation: 'Преобразует строку в верхний регистр.', snippet: 'str_upper(${1:string})' },
        'str_lower': { detail: 'stdlib.str_lower(string)', documentation: 'Преобразует строку в нижний регистр.', snippet: 'str_lower(${1:string})' },
        'str_replace': { detail: 'stdlib.str_replace(string, old, new)', documentation: 'Заменяет все вхождения подстроки `old` на `new`.', snippet: 'str_replace(${1:string}, "${2:old}", "${3:new}")' },
    },
    'time': {
        'time': { detail: 'time.time()', documentation: 'Возвращает текущее время в виде Unix timestamp (число секунд с 1 января 1970 года).', snippet: 'time()' },
        'sleep': { detail: 'time.sleep(seconds)', documentation: 'Приостанавливает выполнение программы на указанное количество секунд.', snippet: 'sleep(${1:seconds})' },
    },
    'file': {
        'open': { detail: 'file.open(path, mode)', documentation: 'Открывает файл. `mode` - это строка, например: "r" (чтение), "w" (запись), "a" (дозапись).', snippet: 'open("${1:path}", "${2:r}")' },
        'read': { detail: 'file.read()', documentation: 'Читает все содержимое открытого файла и возвращает его как строку.', snippet: 'read()' },
        'readline': { detail: 'file.readline()', documentation: 'Читает одну строку из открытого файла.', snippet: 'readline()' },
        'readlines': { detail: 'file.readlines()', documentation: 'Читает все строки из файла и возвращает их в виде списка.', snippet: 'readlines()' },
        'write': { detail: 'file.write(content)', documentation: 'Записывает строку `content` в открытый файл.', snippet: 'write(${1:content})' },
        'close': { detail: 'file.close()', documentation: 'Закрывает ранее открытый файл.', snippet: 'close()' },
    },
    'gui': {
        'create_window': { detail: 'gui.create_window(title, width, height)', documentation: 'Создает главное окно приложения с указанным заголовком и размерами.', snippet: 'create_window("${1:title}", ${2:width}, ${3:height})' },
        'create_label': { detail: 'gui.create_label(text)', documentation: 'Создает и размещает текстовую метку в окне.', snippet: 'create_label("${1:text}")' },
        'create_button': { detail: 'gui.create_button(text, command)', documentation: 'Создает кнопку. `command` - это имя функции (в виде строки), которая будет вызвана при нажатии.', snippet: 'create_button("${1:text}", "${2:command}")' },
        'create_entry': { detail: 'gui.create_entry()', documentation: 'Создает поле для ввода текста.', snippet: 'create_entry()' },
        'get_entry_value': { detail: 'gui.get_entry_value()', documentation: 'Возвращает текст, введенный в поле ввода.', snippet: 'get_entry_value()' },
        'set_label_text': { detail: 'gui.set_label_text(text)', documentation: 'Изменяет текст метки.', snippet: 'set_label_text("${1:text}")' },
        'run_app': { detail: 'gui.run_app()', documentation: 'Запускает главный цикл обработки событий GUI. Эта функция должна вызываться в конце скрипта.', snippet: 'run_app()' },
        'stop': { detail: 'gui.stop()', documentation: 'Завершает главный цикл обработки событий GUI.', snippet: 'stop()' }
    }
};

// --- ОБЩИЕ ДАННЫЕ ДЛЯ ПОДСКАЗОК И ИНФОРМАЦИИ ПРИ НАВЕДЕНИИ ---
const builtInFunctions = {
    'print': {
        detail: 'print(value)',
        documentation: 'Выводит значение в консоль без переноса строки.',
        snippet: 'print(${1})'
    },
    'println': {
        detail: 'println(value)',
        documentation: 'Выводит значение в консоль и добавляет перенос строки.',
        snippet: 'println(${1})'
    },
    'input': {
        detail: 'input()',
        documentation: 'Читает строку текста от пользователя.',
        snippet: 'input()'
    },
    'to_int': {
        detail: 'to_int(value)',
        documentation: 'Преобразует значение в целое число.',
        snippet: 'to_int(${1})'
    },
    'to_str': {
        detail: 'to_str(value)',
        documentation: 'Преобразует значение в строку.',
        snippet: 'to_str(${1})'
    },
    'to_float': {
        detail: 'to_float(value)',
        documentation: 'Преобразует значение в число с плавающей точкой.',
        snippet: 'to_float(${1})'
    },
    'type': {
        detail: 'type(value)',
        documentation: 'Возвращает тип значения (например, "string", "number").',
        snippet: 'type(${1})'
    }
};

const specialClassMethods = {
    '__main__': {
        detail: 'function __main__()',
        documentation: '### Специальный метод (Опасно)\n\nВыполняется, если класс является точкой входа в программу.',
        snippet: 'function __main__()\n\t${1}\nend'
    },
    '__str__': {
        detail: 'function __str__()',
        documentation: '### Специальный метод (Опасно)\n\nВозвращает строковое представление объекта. Вызывается функциями `print`, `println` и `to_str`.',
        snippet: 'function __str__()\n\treturn "${1:string representation}"\nend'
    },
    '__add__': {
        detail: 'function __add__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора сложения (`+`).',
        snippet: 'function __add__(other)\n\t${1}\nend'
    },
    '__sub__': {
        detail: 'function __sub__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора вычитания (`-`).',
        snippet: 'function __sub__(other)\n\t${1}\nend'
    },
    '__mul__': {
        detail: 'function __mul__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора умножения (`*`).',
        snippet: 'function __mul__(other)\n\t${1}\nend'
    },
    '__div__': {
        detail: 'function __div__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора деления (`/`).',
        snippet: 'function __div__(other)\n\t${1}\nend'
    },
    '__radd__': {
        detail: 'function __radd__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПравосторонняя перегрузка оператора сложения (`+`).',
        snippet: 'function __radd__(other)\n\t${1}\nend'
    },
    '__rsub__': {
        detail: 'function __rsub__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПравосторонняя перегрузка оператора вычитания (`-`).',
        snippet: 'function __rsub__(other)\n\t${1}\nend'
    },
    '__rmul__': {
        detail: 'function __rmul__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПравосторонняя перегрузка оператора умножения (`*`).',
        snippet: 'function __rmul__(other)\n\t${1}\nend'
    },
    '__rdiv__': {
        detail: 'function __rdiv__(other)',
        documentation: '### Специальный метод (Опасно)\n\nПравосторонняя перегрузка оператора деления (`/`).',
        snippet: 'function __rdiv__(other)\n\t${1}\nend'
    },
    '__lt__': { detail: 'function __lt__(other)', documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора "меньше" (`<`).', snippet: 'function __lt__(other)\n\t${1}\nend' },
    '__gt__': { detail: 'function __gt__(other)', documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора "больше" (`>`).', snippet: 'function __gt__(other)\n\t${1}\nend' },
    '__le__': { detail: 'function __le__(other)', documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора "меньше или равно" (`<=`).', snippet: 'function __le__(other)\n\t${1}\nend' },
    '__ge__': { detail: 'function __ge__(other)', documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора "больше или равно" (`>=`).', snippet: 'function __ge__(other)\n\t${1}\nend' },
    '__eq__': { detail: 'function __eq__(other)', documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора "равно" (`==`).', snippet: 'function __eq__(other)\n\t${1}\nend' },
    '__ne__': { detail: 'function __ne__(other)', documentation: '### Специальный метод (Опасно)\n\nПерегрузка оператора "не равно" (`!=`).', snippet: 'function __ne__(other)\n\t${1}\nend' },
};

// --- ПРОВАЙДЕР АВТОДОПОЛНЕНИЯ (COMPLETION) ---
const completionProvider = vscode.languages.registerCompletionItemProvider(
    'dark',
    {
        async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const lineText = document.lineAt(position).text;

            // 1. Улучшенная обработка доступа к членам (например, `my_var.met` или `Test(12).`)
            const memberAccessMatch = linePrefix.match(/([a-zA-Z_]\w*(?:\s*\([^)]*\))?)\.([a-zA-Z_]\w*)?$/);
            if (memberAccessMatch) {
                const analysis = getAnalyzedDocument(document);
                let objectName = memberAccessMatch[1];
                let objectType: string | undefined = undefined;

                // Определяем, находимся ли мы внутри метода
                const currentClass = analysis.classes.find(c => position.line > c.startLine && position.line < c.endLine);
                if (currentClass) {
                    const currentMethod = currentClass.methods.find(m => position.line >= m.startLine && position.line <= m.endLine);
                    // Если `objectName` - это первый параметр метода (self/object), то его тип - это текущий класс
                    if (currentMethod && currentMethod.parameters.length > 0 && currentMethod.parameters[0].name === objectName) {
                        objectType = currentClass.name;
                    }
                }

                // Если тип еще не определен, ищем его среди глобальных переменных
                if (!objectType) {
                    const globalVar = analysis.globals.find(g => g.name === objectName);
                    if (globalVar && globalVar.type) {
                        objectType = globalVar.type;
                    }
                }

                // Если это вызов конструктора на лету, например `Test(12).`
                const constructorCallMatch = objectName.match(/([a-zA-Z_]\w*)\s*\([^)]*\)$/);
                if (constructorCallMatch) {
                    const className = constructorCallMatch[1];
                    if (analysis.classes.some(c => c.name === className)) {
                        objectType = className;
                    }
                }

                // Если мы нашли тип объекта, предлагаем методы этого класса
                if (objectType) {
                    const classInfo = analysis.classes.find(c => c.name === objectType);
                    if (classInfo) {
                        const methodCompletions = classInfo.methods.map(method => createMethodCompletionItem(method));
                        const propertyCompletions = classInfo.properties.map(prop => 
                            new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property)
                        );
                        return [...methodCompletions, ...propertyCompletions];
                    }
                }
            }
            // Улучшенное автодополнение для `from ... use ...`
            const fromUseContextMatch = lineText.match(/^\s*from\s*"([^"]+)"\s+use\s+(.*)/);
            if (fromUseContextMatch) {
                const useKeywordIndex = lineText.indexOf('use');
                if (position.character > useKeywordIndex + 3) { // Курсор после 'use '
                    const moduleName = fromUseContextMatch[1];
                    const alreadyImported = fromUseContextMatch[2].split(',').map(s => s.trim());

                    const currentDir = path.dirname(document.uri.fsPath);
                    const modulePath = path.resolve(currentDir, `${moduleName}.dark`);

                    try {
                        const moduleUri = vscode.Uri.file(modulePath);
                        const moduleDoc = await vscode.workspace.openTextDocument(moduleUri);
                        const moduleAnalysis = analyzeDocument(moduleDoc); // Используем обычный analyzeDocument

                        const suggestions: vscode.CompletionItem[] = [];
                        
                        moduleAnalysis.functions.forEach(f => suggestions.push(new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function)));
                        moduleAnalysis.globals.forEach(g => suggestions.push(new vscode.CompletionItem(g.name, vscode.CompletionItemKind.Variable)));
                        moduleAnalysis.classes.forEach(c => suggestions.push(new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Class)));

                        // Фильтруем уже добавленные имена
                        return suggestions.filter(item => !alreadyImported.includes(item.label as string));

                    } catch (error) {
                        console.error(`Could not analyze module ${moduleName}:`, error);
                        return []; // Не удалось прочитать/проанализировать файл
                    }
                }
            }
            // Специальная логика для автодополнения внутри import "..."
            const importMatch = lineText.match(/^\s*import\s*"(.*)/);
            if (importMatch) {
                const quoteStartIndex = lineText.indexOf('"');
                // Убедимся, что курсор находится после открывающей кавычки
                if (position.character > quoteStartIndex) {
                    // Предлагаем все модули из стандартной библиотеки
                    return Object.keys(standardLibrary).map(
                        name => new vscode.CompletionItem(name, vscode.CompletionItemKind.Module)
                    );
                }
            }

            // 2. Глобальные подсказки (если не было точки)
            const keywords = [
                'if', 'then', 'else', 'end', 'while', 'do', 'for', 'in', 'return', 'import', 'function', 'try', 'except', 'and', 'or', 'not', 'class', 'from', 'use'
            ];
            const keywordCompletions = keywords.map(
                keyword => new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword)
            );

            const functionCompletions = Object.entries(builtInFunctions).map(([name, data]) => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                item.detail = data.detail;
                item.documentation = new vscode.MarkdownString(data.documentation);
                item.insertText = new vscode.SnippetString(data.snippet);
                return item;
            });

            const constants = ['true', 'false'];
            const constantCompletions = constants.map(
                c => new vscode.CompletionItem(c, vscode.CompletionItemKind.Constant)
            );

            // Анализ текущего файла
            const analysis = getAnalyzedDocument(document);
            // Определяем, в какой функции мы находимся
            let currentFunction = analysis.functions.find(
                f => position.line >= f.startLine && position.line <= f.endLine
            );

            const availableVariables = new Set<string>();

            // Также проверяем, не находимся ли мы внутри метода класса
            if (!currentFunction) {
                const currentClass = analysis.classes.find(c => position.line > c.startLine && position.line < c.endLine);
                if (currentClass) {
                    const currentMethod = currentClass.methods.find(m => position.line >= m.startLine && position.line <= m.endLine);
                    if (currentMethod) {
                        currentFunction = currentMethod; // Рассматриваем метод как текущую функцию
                    }
                }
            }

            // Глобальные переменные доступны всегда
            analysis.globals.forEach(v => availableVariables.add(v.name));
            
            // Имена, импортированные через `from ... use ...` также глобальны
            analysis.usedImports.forEach(v => availableVariables.add(v.name));

            // Если мы внутри функции, добавляем ее параметры и локальные переменные
            if (currentFunction) {
                currentFunction.parameters.forEach(p => availableVariables.add(p.name));
                currentFunction.variables.forEach(v => availableVariables.add(v.name));
            }

            const variableCompletions: vscode.CompletionItem[] = [];
            availableVariables.forEach(name => {
                variableCompletions.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable));
            });

            // Подсказки для импортов
            const importCompletions = analysis.imports.map(imp =>
                new vscode.CompletionItem(imp.name, vscode.CompletionItemKind.Module)
            );

            // Подсказки для классов
            const classCompletions = analysis.classes.map(cls => {
                const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);
                item.detail = `class ${cls.name}`;
                item.documentation = 'Пользовательский класс из текущего файла.';
                return item;
            });

            // Подсказки для пользовательских функций
            const userFunctionCompletions = analysis.functions.map(funcInfo => {
                const item = new vscode.CompletionItem(funcInfo.name, vscode.CompletionItemKind.Function);
                item.detail = funcInfo.detail;
                item.documentation = new vscode.MarkdownString(funcInfo.documentation);
                item.insertText = funcInfo.snippet;
                return item;
            });

            const allCompletions = [
                ...keywordCompletions,
                ...functionCompletions,
                ...constantCompletions,
                ...variableCompletions,
                ...userFunctionCompletions,
                ...importCompletions,
                ...classCompletions
            ];

            // Контекстные подсказки внутри класса (добавляем к общему списку)
            const currentClass = analysis.classes.find(
                c => position.line > c.startLine && position.line < c.endLine
            );

            if (currentClass) {
                const specialMethodCompletions = Object.entries(specialClassMethods).map(([name, data]) => {
                    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
                    item.detail = data.detail;
                    item.documentation = new vscode.MarkdownString(data.documentation);
                    item.insertText = new vscode.SnippetString(data.snippet);
                    return item;
                });
                allCompletions.push(...specialMethodCompletions);
            }

            return allCompletions;
        }
    },
    '.' // Триггер для автодополнения
);

function createMethodCompletionItem(method: AnalyzedFunction): vscode.CompletionItem {
    const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
    item.detail = method.detail;
    item.documentation = new vscode.MarkdownString(method.documentation);
    item.insertText = new vscode.SnippetString(method.snippet.value.replace(/\(.*\)/, '($0)')); // Очищаем параметры для простого вызова
    return item;
}

// --- ПРОВАЙДЕР ИНФОРМАЦИИ ПРИ НАВЕДЕНИИ (HOVER) ---
const hoverProvider = vscode.languages.registerHoverProvider(
    'dark',
    {
        async provideHover(document, position, token) {
            const range = document.getWordRangeAtPosition(position);
            if (!range) { return; }
            const word = document.getText(range);

            // 1. Проверка на доступ к члену (os.getcwd)
            const lineText = document.lineAt(position.line).text;
            const memberAccessRegex = new RegExp(`([a-zA-Z_]\\w*)\\.${word}\\b`);
            const match = lineText.match(memberAccessRegex);
            const analysis = getAnalyzedDocument(document);

            // 0. Проверка на импорт через `from ... use ...`
            const isUsedImport = analysis.usedImports.some(imp => imp.name === word);
            if (isUsedImport) {
                // Найдем строку, где этот импорт определен
                const fromUseRegex = /^\s*from\s*"((?:\\.|[^"\\])*)"\s+use\s+(.*)/;
                for (let i = 0; i < document.lineCount; i++) {
                    const line = document.lineAt(i).text;
                    const fromUseMatch = line.match(fromUseRegex);
                    if (fromUseMatch) {
                        const importedNames = fromUseMatch[2].split(',').map(n => n.trim());
                        if (importedNames.includes(word)) {
                            const moduleName = fromUseMatch[1];
                            const currentDir = path.dirname(document.uri.fsPath);
                            const modulePath = path.resolve(currentDir, `${moduleName}.dark`);
                            try {
                                const moduleUri = vscode.Uri.file(modulePath);
                                const moduleDoc = await vscode.workspace.openTextDocument(moduleUri);
                                const moduleAnalysis = analyzeDocument(moduleDoc);
                                
                                const funcInfo = moduleAnalysis.functions.find(f => f.name === word);
                                if (funcInfo) {
                                    return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(funcInfo.detail, 'dark').appendMarkdown(`---\n${funcInfo.documentation}`), range);
                                }
                                // Можно добавить аналогичный поиск для глобальных переменных и классов, если нужно
                            } catch (error) { /* Файл не найден или не удалось проанализировать, молча выходим */ }
                            break; // Нашли, выходим из цикла
                        }
                    }
                }
            }

            if (match) {
                const objectName = match[1];
                const memberName = word;

                // Если это член стандартной библиотеки
                if (objectName in standardLibrary) {
                    const module = standardLibrary[objectName as keyof typeof standardLibrary] as Record<string, any>;
                    if (memberName in module) {
                        const funcData = module[memberName];
                        const content = new vscode.MarkdownString()
                            .appendCodeblock(funcData.detail, 'dark')
                            .appendMarkdown(`---\n${funcData.documentation}`);
                        return new vscode.Hover(content, range);
                    }
                }

                // NEW: Hover для методов класса
                const matchingMethods = analysis.classes.flatMap(cls => 
                    cls.methods.filter(m => m.name === memberName)
                );
    
                if (matchingMethods.length > 0) {
                    const content = new vscode.MarkdownString();
                    matchingMethods.forEach(method => {
                        content.appendCodeblock(method.detail, 'dark')
                               .appendMarkdown(`*${method.documentation}*`)
                               .appendMarkdown('\n\n---\n\n');
                    });
                    return new vscode.Hover(content, range);
                }
            }

            // 2. Проверка на встроенные методы (len, upper, и т.д.)
            for (const [type, methods] of Object.entries(builtInMethods)) {
                if (word in methods) {
                    const methodData = methods[word as keyof typeof methods];
                    const content = new vscode.MarkdownString()
                        .appendCodeblock(methodData.detail, 'dark')
                        .appendMarkdown(`---\nМетод для типа **${type}**.\n\n${methodData.documentation}`);
                    return new vscode.Hover(content, range);
                }
            }

            // Подсказка для встроенных функций
            if (word in builtInFunctions) {
                const funcData = builtInFunctions[word as keyof typeof builtInFunctions];
                const content = new vscode.MarkdownString();
                content.appendCodeblock(funcData.detail, 'dark');
                content.appendMarkdown('---');
                content.appendMarkdown(funcData.documentation);
                return new vscode.Hover(content, range);
            }

            // Подсказка для пользовательских функций
            const funcInfo = analysis.functions.find(f => f.name === word);

            if (funcInfo) {
                const content = new vscode.MarkdownString();
                content.appendCodeblock(funcInfo.detail, 'dark');
                content.appendMarkdown('---');
                content.appendMarkdown(funcInfo.documentation);
                return new vscode.Hover(content, range);
            }

            // NEW: Подсказка для имен классов
            const classInfo = analysis.classes.find(c => c.name === word);
            if (classInfo) {
                const content = new vscode.MarkdownString();
                let detail = `class ${classInfo.name}`;
                if (classInfo.parent) {
                    detail += `(${classInfo.parent})`;
                }
                content.appendCodeblock(detail, 'dark');
                content.appendMarkdown(`\n---\nКласс, определенный в этом файле.`);
                return new vscode.Hover(content, range);
            }
        }
    }
);

// --- ПРОВАЙДЕР СЕМАНТИЧЕСКИХ ТОКЕНОВ ДЛЯ ПОДСВЕТКИ ---

// Определяем типы токенов, которые мы будем использовать.
// 'namespace' для импортов, 'variable' для переменных, 'parameter' для параметров функций.
const tokenTypes = ['namespace', 'variable', 'parameter', 'function', 'class', 'method'];
const tokenModifiers: string[] = [];
const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

const semanticTokensProvider: vscode.DocumentSemanticTokensProvider = {
    async provideDocumentSemanticTokens(document: vscode.TextDocument): Promise<vscode.SemanticTokens> {
        // Получаем проанализированную структуру документа
        const analysis = getAnalyzedDocument(document);
        const builder = new vscode.SemanticTokensBuilder(legend);

        const globalNames = new Set(analysis.globals.map(g => g.name));
        const functionNames = new Set(analysis.functions.map(f => f.name));
        const classNames = new Set(analysis.classes.map(c => c.name));
        const importNames = new Set(analysis.imports.map(i => i.name));
        const usedImportNames = new Set(analysis.usedImports.map(i => i.name));

        const tokenMap = {
            import: tokenTypes.indexOf('namespace'),
            parameter: tokenTypes.indexOf('parameter'),
            variable: tokenTypes.indexOf('variable'),
            function: tokenTypes.indexOf('function'),
            class: tokenTypes.indexOf('class'),
            method: tokenTypes.indexOf('method'),
            global: tokenTypes.indexOf('variable'),
            local: tokenTypes.indexOf('variable'),
        };

        let inMultiLineString: '"""' | "'''" | null = null;

        for (let i = 0; i < document.lineCount; i++) {
            // --- Новая логика для подсветки `from ... use ...` ---
            const fromUseRegex = /^\s*from\s*"((?:\\.|[^"\\])*)"\s+use\s+(.*)/;
            const fromUseMatch = document.lineAt(i).text.match(fromUseRegex);
            if (fromUseMatch) {
                const moduleName = fromUseMatch[1];
                const namesStr = fromUseMatch[2];
                const currentDir = path.dirname(document.uri.fsPath);
                const modulePath = path.resolve(currentDir, `${moduleName}.dark`);

                try {
                    const moduleUri = vscode.Uri.file(modulePath);
                    const moduleDoc = await vscode.workspace.openTextDocument(moduleUri);
                    const moduleAnalysis = analyzeDocument(moduleDoc);

                    const moduleFunctionNames = new Set(moduleAnalysis.functions.map(f => f.name));
                    const moduleGlobalNames = new Set(moduleAnalysis.globals.map(g => g.name));

                    const nameRegex = /[a-zA-Z_]\w*/g;
                    let nameMatch;
                    while ((nameMatch = nameRegex.exec(namesStr)) !== null) {
                        const name = nameMatch[0];
                        const nameIndex = fromUseMatch[0].indexOf(namesStr) + nameMatch.index;
                        if (moduleFunctionNames.has(name)) {
                            builder.push(i, nameIndex, name.length, tokenMap.function, 0);
                        } else if (moduleGlobalNames.has(name)) {
                            builder.push(i, nameIndex, name.length, tokenMap.variable, 0);
                        }
                    }
                } catch (e) {
                    // Не удалось проанализировать модуль, ничего страшного, просто не будет подсветки
                }
            }
            // --- Конец новой логики ---

            const line = document.lineAt(i);
            const currentFunction = analysis.functions.find(f => i >= f.startLine && i <= f.endLine);
            const currentClass = analysis.classes.find(c => i >= c.startLine && i <= c.endLine);
            
            const localNames = new Set<string>();
            const paramNames = new Set<string>();
            if (currentFunction) {
                currentFunction.variables.forEach(v => localNames.add(v.name));
                currentFunction.parameters.forEach(p => paramNames.add(p.name));
            }

            if (currentClass) {
                const currentMethod = currentClass.methods.find(m => i >= m.startLine && i <= m.endLine);
                if (currentMethod) {
                    currentMethod.variables.forEach(v => localNames.add(v.name));
                    currentMethod.parameters.forEach(p => paramNames.add(p.name));
                }
            }

            let lineTextForAnalysis = line.text;

            // Обработка многострочных комментариев
            if (inMultiLineString) {
                const endMarkerIndex = lineTextForAnalysis.indexOf(inMultiLineString);
                if (endMarkerIndex !== -1) {
                    // Часть строки до конца многострочного комментария заменяем пробелами
                    lineTextForAnalysis = ' '.repeat(endMarkerIndex + 3) + lineTextForAnalysis.substring(endMarkerIndex + 3);
                    inMultiLineString = null;
                } else {
                    // Вся строка - часть многострочного комментария
                    lineTextForAnalysis = ' '.repeat(line.text.length);
                }
            }

            // Поиск начала новых многострочных комментариев
            const multiStringRegex = /"""|'''/g;
            let multiMatch;
            while ((multiMatch = multiStringRegex.exec(lineTextForAnalysis)) !== null) {
                if (!inMultiLineString) {
                    inMultiLineString = multiMatch[0] as '"""' | "'''";
                    const restOfString = lineTextForAnalysis.substring(multiMatch.index + 3);
                    const endMarkerIndex = restOfString.indexOf(inMultiLineString);
                    if (endMarkerIndex !== -1) {
                        const endIndexInLine = multiMatch.index + 3 + endMarkerIndex + 3;
                        lineTextForAnalysis = lineTextForAnalysis.substring(0, multiMatch.index) + ' '.repeat(endIndexInLine - multiMatch.index) + lineTextForAnalysis.substring(endIndexInLine);
                        inMultiLineString = null;
                    } else {
                        lineTextForAnalysis = lineTextForAnalysis.substring(0, multiMatch.index) + ' '.repeat(lineTextForAnalysis.length - multiMatch.index);
                        break;
                    }
                }
            }

            // Заменяем однострочные строки и комментарии на пробелы
            lineTextForAnalysis = lineTextForAnalysis.replace(/"(?:\\.|[^"\\])*"/g, s => ' '.repeat(s.length));
            lineTextForAnalysis = lineTextForAnalysis.replace(/'(?:\\.|[^'\\])*'/g, s => ' '.repeat(s.length));
            lineTextForAnalysis = lineTextForAnalysis.replace(/#.*$/gm, s => ' '.repeat(s.length));

            // Ищем все "слова" (потенциальные идентификаторы) в строке
            const wordRegex = /[a-zA-Z_]\w*/g;
            let match;
            while ((match = wordRegex.exec(lineTextForAnalysis)) !== null) {
                const word = match[0];
                const index = match.index;
                let tokenType = -1;

                // Сначала проверяем локальный контекст (параметры, локальные переменные, методы)
                if (paramNames.has(word)) {
                    tokenType = tokenMap.parameter;
                } else if (localNames.has(word)) {
                    tokenType = tokenMap.local;
                } else if (currentClass && currentClass.methods.some(m => m.name === word)) {
                    const lineTrim = line.text.trim();
                    if (lineTrim.startsWith(`function ${word}`)) {
                        tokenType = tokenMap.method;
                    }
                }

                // Если в локальном контексте не найдено, проверяем глобальный
                if (tokenType === -1) {
                    if (classNames.has(word)) {
                    tokenType = tokenMap.class;
                    } else if (globalNames.has(word)) {
                    tokenType = tokenMap.global;
                } else if (functionNames.has(word)) {
                    tokenType = tokenMap.function; // Standalone function
                } else if (importNames.has(word)) {
                    tokenType = tokenMap.import;
                } else if (usedImportNames.has(word)) {
                    // Если это импортированное имя, проверим, вызывается ли оно как функция
                    const textAfterWord = lineTextForAnalysis.substring(index + word.length);
                    if (/^\s*\w*\(/.test(textAfterWord)) { // \w* для поддержки цепочек вызовов типа a()()
                        tokenType = tokenMap.function;
                    } else {
                        tokenType = tokenMap.variable; // Иначе это переменная (например, PI)
                    }
                }
                }

                if (tokenType !== -1) {
                    builder.push(i, index, word.length, tokenType, 0);
                }
            }
        }
        return builder.build();
    }
};

/**
 * Анализирует документ на наличие необъявленных переменных и обновляет диагностику.
 * @param document Текстовый документ для анализа.
 * @param collection Коллекция диагностики для обновления.
 */
function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection) {
    const context = (global as any).extensionContext as vscode.ExtensionContext;
    if (document.languageId !== 'dark') {
        return;
    }

    const selectedDenvPath = context.workspaceState.get<string>('selectedDenvPath');
    let executorPath: string | null = getExecutorCommand(context);
    const env = { ...process.env };

    if (selectedDenvPath) {
        const platform = process.platform;
        const executableName = platform === 'win32' ? 'dark.exe' : 'dark';
        executorPath = path.join(selectedDenvPath, 'bin', executableName);
        env['DARK_ENV'] = selectedDenvPath;
    }

    if (!executorPath) {
        // Если путь не настроен, молча выходим. Можно добавить однократное предупреждение.
        collection.delete(document.uri); // Очищаем предыдущие ошибки
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    // Используем execFile для безопасности (избегаем инъекций в оболочку)
    execFile(executorPath, ['--check', document.uri.fsPath], (err, stdout, stderr) => {
        // Линтер выходит с кодом 1 при ошибке, что execFile считает ошибкой.
        // Нас интересует stderr независимо от кода выхода.
        if (stderr) {
            // Пример строки ошибки:
            // Семантическая ошибка в файле C:\...\file.dark:5:1: some message
            const errorRegex = /^(?:Синтаксическая|Семантическая|Лексическая) ошибка в файле .*?:(\d+):(\d+): (.*)$/gm;
            let match;

            while ((match = errorRegex.exec(stderr)) !== null) {
                const line = parseInt(match[1], 10) - 1; // VS Code использует 0-based индексацию
                const column = parseInt(match[2], 10) - 1; // VS Code использует 0-based индексацию
                const message = match[3].trim();

                // Убедимся, что строка и столбец корректны
                if (line >= 0 && line < document.lineCount) {
                    const lineText = document.lineAt(line).text;
                    // Подсвечиваем слово в месте ошибки или всю строку, если слово не найдено
                    const wordRange = document.getWordRangeAtPosition(new vscode.Position(line, column));
                    const range = wordRange || new vscode.Range(new vscode.Position(line, column), new vscode.Position(line, lineText.length));

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        message,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostics.push(diagnostic);
                }
            }
        }
        collection.set(document.uri, diagnostics);
    });
}

/**
 * Получает команду для запуска исполняемого файла Dark.
 * На Linux по умолчанию используется 'dark', если путь не задан в настройках.
 * На других системах требуется явное указание пути.
 * @returns {string | null} Команда или путь к исполняемому файлу, или null, если не найден.
 */
function getExecutorCommand(context: vscode.ExtensionContext): string | null {
    // 1. Приоритет у выбранного denv
    const selectedDenvPath = context.workspaceState.get<string>('selectedDenvPath');
    if (selectedDenvPath) {
        const platform = process.platform;
        const executableName = platform === 'win32' ? 'dark.exe' : 'dark';
        return path.join(selectedDenvPath, 'bin', executableName);
    }

    // 2. Если denv не выбран, смотрим глобальные настройки
    const config = vscode.workspace.getConfiguration('dark');
    const executorPath = config.get<string>('executorPath');
    if (executorPath) {
        return executorPath;
    }

    // 3. Если путь не указан и система - Linux, предполагаем, что 'dark' есть в PATH.
    if (process.platform === 'linux') {
        return 'dark';
    }

    // 4. Для других систем путь обязателен.
    return null;
}

export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
        // Проверяем, что darkTerminal все еще определен перед доступом к processId
        if (darkTerminal) {
            terminal.processId.then(id => {
                darkTerminal?.processId.then(darkId => {
                    if (id === darkId) darkTerminal = undefined;
                });
            });
        }
    }));

    // --- Инициализация UI для denv ---
    (global as any).extensionContext = context; // Сохраняем контекст глобально для доступа
    denvStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    denvStatusBarItem.command = 'dark.selectDenv';
    context.subscriptions.push(denvStatusBarItem);
    registerDenvSelectorCommand(context);
    updateStatusBar(context);

    const runCommand = vscode.commands.registerCommand('dark.run', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor found.');
            return;
        }
        if (editor.document.languageId !== 'dark') {
            vscode.window.showErrorMessage('This command can only be used with .dark files.');
            return;
        }

        const executorCommand = getExecutorCommand(context); // Получаем команду с учетом denv
        if (!executorCommand) {
            vscode.window.showErrorMessage(
                'Интерпретатор Dark не найден. Выберите окружение (denv) или укажите "dark.executorPath" в настройках.'
            );
            return;
        }
        const filePath = editor.document.uri.fsPath;
        const terminal = getDarkTerminal();
        const selectedDenvPath = context.workspaceState.get<string>('selectedDenvPath');

        // Устанавливаем переменную окружения ПЕРЕД запуском команды
        if (selectedDenvPath) {
            if (process.platform === 'win32') {
                // Для cmd, PowerShell и bash-подобных оболочек (Git Bash) на Windows
                terminal.sendText(`source "${selectedDenvPath}/bin/activate"`, true);
            } else {
                // Для bash/zsh/etc.
                terminal.sendText(`source "${selectedDenvPath}/bin/activate"`, true);
            }
        }

        terminal.show();
        const command = `"${executorCommand}" "${filePath}"`;
        terminal.sendText(command);
    });

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('dark');
    context.subscriptions.push(diagnosticCollection);

    // Функция debounce для задержки выполнения
    const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
        let timeout: NodeJS.Timeout;

        return (...args: Parameters<F>): Promise<ReturnType<F>> =>
            new Promise(resolve => {
                clearTimeout(timeout);
                timeout = setTimeout(() => resolve(func(...args)), waitFor);
            });
    };

    const debouncedUpdateDiagnostics = debounce((doc: vscode.TextDocument) => {
        updateDiagnostics(doc, diagnosticCollection);
    }, 500); // Задержка в 500 мс

    if (vscode.window.activeTextEditor) {
        debouncedUpdateDiagnostics(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc, diagnosticCollection)),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'dark') {
                debouncedUpdateDiagnostics(event.document);
            }
        }),
        vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri))
    );

    context.subscriptions.push(
        runCommand,
        completionProvider,
        hoverProvider,
        vscode.languages.registerDocumentSemanticTokensProvider('dark', semanticTokensProvider, legend)
    );
}

export function deactivate() {
    if (darkTerminal) {
        darkTerminal.dispose();
    }
}
