import * as vscode from 'vscode';

// Этот файл содержит статические данные для расширения языка Dark,
// такие как встроенные функции, модули стандартной библиотеки и методы.

export const builtInMethods = {
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

export const standardLibrary = {
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
        'post': { detail: 'http.post(url, data)', documentation: 'Выполняет HTTP POST-запрос с телом `data` (словарь) и возвращает ответ.', snippet: 'post("${1:url}", ${2:data})' },
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
        'stop': { detail: 'gui.stop()', documentation: 'Завершает главный цикл обработки событий GUI.', snippet: 'stop()' }    },
    'color': {
        'rgb': { detail: 'color.rgb(r, g, b, text)', documentation: 'Возвращает текст, окрашенный в указанный RGB цвет.', snippet: 'rgb(${1:255}, ${2:100}, ${3:150}, "${4:text}")' },
        'rgba': { detail: 'color.rgba(r, g, b, a, text)', documentation: 'Возвращает текст, окрашенный в указанный RGBA цвет.', snippet: 'rgba(${1:255}, ${2:100}, ${3:150}, ${4:255}, "${5:text}")' },
        'hex': { detail: 'color.hex(hex_string, text)', documentation: 'Возвращает текст, окрашенный в указанный HEX цвет (например, "#ff6496").', snippet: 'hex("${1:#ff6496}", "${2:text}")' },
        'hsl': { detail: 'color.hsl(h, s, l, text)', documentation: 'Возвращает текст, окрашенный в указанный HSL цвет.', snippet: 'hsl(${1:340}, ${2:100}, ${3:70}, "${4:text}")' },
        'red': { detail: 'color.red(text)', documentation: 'Возвращает текст, окрашенный в красный цвет.', snippet: 'red("${1:text}")' },
        'green': { detail: 'color.green(text)', documentation: 'Возвращает текст, окрашенный в зеленый цвет.', snippet: 'green("${1:text}")' },
        'blue': { detail: 'color.blue(text)', documentation: 'Возвращает текст, окрашенный в синий цвет.', snippet: 'blue("${1:text}")' },
        'yellow': { detail: 'color.yellow(text)', documentation: 'Возвращает текст, окрашенный в желтый цвет.', snippet: 'yellow("${1:text}")' },
        'cyan': { detail: 'color.cyan(text)', documentation: 'Возвращает текст, окрашенный в голубой цвет.', snippet: 'cyan("${1:text}")' },
        'magenta': { detail: 'color.magenta(text)', documentation: 'Возвращает текст, окрашенный в пурпурный цвет.', snippet: 'magenta("${1:text}")' },
        'white': { detail: 'color.white(text)', documentation: 'Возвращает текст, окрашенный в белый цвет.', snippet: 'white("${1:text}")' },
        'black': { detail: 'color.black(text)', documentation: 'Возвращает текст, окрашенный в черный цвет.', snippet: 'black("${1:text}")' },
        'orange': { detail: 'color.orange(text)', documentation: 'Возвращает текст, окрашенный в оранжевый цвет.', snippet: 'orange("${1:text}")' },
        'purple': { detail: 'color.purple(text)', documentation: 'Возвращает текст, окрашенный в фиолетовый цвет.', snippet: 'purple("${1:text}")' },
        'pink': { detail: 'color.pink(text)', documentation: 'Возвращает текст, окрашенный в розовый цвет.', snippet: 'pink("${1:text}")' },
        'brown': { detail: 'color.brown(text)', documentation: 'Возвращает текст, окрашенный в коричневый цвет.', snippet: 'brown("${1:text}")' },
        'gray': { detail: 'color.gray(text)', documentation: 'Возвращает текст, окрашенный в серый цвет.', snippet: 'gray("${1:text}")' },
        'light_gray': { detail: 'color.light_gray(text)', documentation: 'Возвращает текст, окрашенный в светло-серый цвет.', snippet: 'light_gray("${1:text}")' },
        'dark_gray': { detail: 'color.dark_gray(text)', documentation: 'Возвращает текст, окрашенный в темно-серый цвет.', snippet: 'dark_gray("${1:text}")' },
        'light_blue': { detail: 'color.light_blue(text)', documentation: 'Возвращает текст, окрашенный в светло-синий цвет.', snippet: 'light_blue("${1:text}")' },
        'light_green': { detail: 'color.light_green(text)', documentation: 'Возвращает текст, окрашенный в светло-зеленый цвет.', snippet: 'light_green("${1:text}")' },
        'light_cyan': { detail: 'color.light_cyan(text)', documentation: 'Возвращает текст, окрашенный в светло-голубой цвет.', snippet: 'light_cyan("${1:text}")' },
        'light_red': { detail: 'color.light_red(text)', documentation: 'Возвращает текст, окрашенный в светло-красный цвет.', snippet: 'light_red("${1:text}")' },
        'light_magenta': { detail: 'color.light_magenta(text)', documentation: 'Возвращает текст, окрашенный в светло-пурпурный цвет.', snippet: 'light_magenta("${1:text}")' },
        'dark_red': { detail: 'color.dark_red(text)', documentation: 'Возвращает текст, окрашенный в темно-красный цвет.', snippet: 'dark_red("${1:text}")' },
        'dark_green': { detail: 'color.dark_green(text)', documentation: 'Возвращает текст, окрашенный в темно-зеленый цвет.', snippet: 'dark_green("${1:text}")' },
        'dark_blue': { detail: 'color.dark_blue(text)', documentation: 'Возвращает текст, окрашенный в темно-синий цвет.', snippet: 'dark_blue("${1:text}")' },
        'dark_yellow': { detail: 'color.dark_yellow(text)', documentation: 'Возвращает текст, окрашенный в темно-желтый цвет.', snippet: 'dark_yellow("${1:text}")' },
        'dark_cyan': { detail: 'color.dark_cyan(text)', documentation: 'Возвращает текст, окрашенный в темно-голубой цвет.', snippet: 'dark_cyan("${1:text}")' },
        'dark_magenta': { detail: 'color.dark_magenta(text)', documentation: 'Возвращает текст, окрашенный в темно-пурпурный цвет.', snippet: 'dark_magenta("${1:text}")' }
    },
    'python': {
        'exec': { detail: 'python.exec(code_string)', documentation: 'Выполняет код Python в текущем окружении. Требует директиву `#!USE_WITH_PYTHON` в начале файла.', snippet: 'exec(\'${1:print("Hello from Python!")}\')' }
    },
};

export const builtInFunctions = {
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