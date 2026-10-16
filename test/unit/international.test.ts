import assert from 'node:assert/strict';
import test from 'node:test';
import { dateYear, parseDate } from '../../src/dates';
import { cardBase, clarifications } from '../../src/edit';
import { language, resolveLanguage, setLanguage, STRINGS } from '../../src/i18n';
import { ansiCodePage, decode } from '../../src/import/gedcom';
import { lifeYears, nameLines, yearLabel } from '../../src/model';
import { assumedParent, familyName, firstSurname, icelandicPatronymic, inheritedScheme, personTitle, schemeByPlace, schemeOf, secondSurname, suggestNames, type Relative } from '../../src/names';
import { formatDate } from '../../src/profile-text';

const rel = (over: Partial<Relative>): Relative => ({ path: 'x', name: 'x', sex: 'unknown', scheme: null, surname: '', given_name: '', patronymic: '', birth_surname: '', parents: [], children: [], spouses: [], ...over });

test('dates in English and GEDCOM words mean what the Russian ones do', () => {
  const kinds = (values: string[]) => values.map((value) => { const date = parseDate(value); return date && date.kind !== 'unknown' ? `${date.kind} ${date.date.year}` : String(date?.kind ?? null); });
  assert.deepEqual(kinds(['abt 1915', 'ABT 1915', 'about 1915', 'c. 1915', 'ca. 1915', 'circa 1915', 'est 1915', 'estimated 1915', 'cal 1915', 'около 1915', '~1915', '1915?']), Array(12).fill('about 1915'));
  assert.deepEqual(kinds(['before 1915', 'bef. 1915', 'BEF 1915', 'до 1915', '<1915']), Array(5).fill('before 1915'));
  assert.deepEqual(kinds(['after 1915', 'aft 1915', 'после 1915', '>1915']), Array(4).fill('after 1915'));
  assert.deepEqual(kinds(['between 1910 and 1920', 'bet 1910 and 1920', 'между 1910 и 1920', '1910..1920', '1910–1920', 'from 1910 to 1920']), Array(6).fill('between 1910'));
  assert.deepEqual(kinds(['1910s', "1910's", '1910-е', '1910-е гг.']), Array(4).fill('decade 1910'));
  assert.deepEqual(parseDate('7 MAR 1915'), { kind: 'exact', date: { year: 1915, month: 3, day: 7 } });
  assert.deepEqual(parseDate('March 7, 1915'), { kind: 'exact', date: { year: 1915, month: 3, day: 7 } });
  assert.deepEqual(parseDate('07.03.1915'), { kind: 'exact', date: { year: 1915, month: 3, day: 7 } });
  assert.equal(parseDate('весна'), null);
  assert.equal(parseDate('1915-13'), null);
  assert.equal(dateYear('abt 1890'), 1890);
});

test('labels and the profile read English dates in either language', () => {
  setLanguage('en');
  assert.equal(yearLabel('abt 1915'), '1915?');
  assert.equal(yearLabel('bef 1915'), '<1915');
  assert.equal(yearLabel('1910s'), '1910s');
  assert.equal(lifeYears('c. 1890', 'after 1950', 'deceased'), '1890?–>1950');
  assert.equal(lifeYears('2001', '', 'living'), 'b. 2001');
  assert.equal(formatDate('abt 1915', 'en'), 'about 1915');
  assert.equal(formatDate('bef 7 MAR 1915', 'en'), 'before 7 March 1915');
  assert.equal(formatDate('1910s', 'ru'), '1910-е');
  assert.equal(formatDate('between 1910 and 1920', 'ru'), 'между 1910 и 1920');
  setLanguage('ru');
  assert.equal(yearLabel('1910s'), '1910-е');
  assert.equal(lifeYears('2001', '', 'living'), 'р. 2001');
});

test('names are written in the order of their scheme', () => {
  const parts = { surname: 'Smith', given_name: 'Mary Ann', birth_surname: 'Jones' };
  assert.equal(personTitle(parts, 'western'), 'Mary Ann Smith (Jones)');
  assert.equal(personTitle(parts, 'russian'), 'Smith Mary Ann (Jones)');
  assert.equal(personTitle({ surname: 'Kim', given_name: 'Min-jun' }, 'eastern'), 'Kim Min-jun');
  assert.equal(personTitle({ given_name: 'Jón', patronymic: 'Sigurðsson' }, 'icelandic'), 'Jón Sigurðsson');
  assert.equal(personTitle({ given_name: 'Aristotle' }, 'western'), 'Aristotle', 'no surname at all');
  assert.equal(personTitle({}, 'western'), '?');
  assert.deepEqual(nameLines('Mary Ann Smith (Jones)', 'Smith'), ['Mary Ann', 'Smith (Jones)']);
  assert.deepEqual(nameLines('Озерова Светлана Борисовна (Кравченко)', 'Озерова'), ['Озерова (Кравченко)', 'Светлана Борисовна']);
  assert.equal(nameLines('Aristotle', ''), undefined);
});

test('hints from relatives follow the scheme; Russian rules stay Russian', () => {
  const father = rel({ sex: 'male', surname: 'García Márquez', given_name: 'Gabriel' });
  const mother = rel({ sex: 'female', surname: 'Barcha Pardo', given_name: 'Mercedes' });
  assert.deepEqual(suggestNames('spanish', 'male', [father, mother], [], []), { surname: 'García Barcha', given_name: '', patronymic: '' });
  assert.equal(firstSurname('de la Fuente López'), 'de la Fuente');
  assert.equal(secondSurname('Ortega y Gasset'), 'Gasset');
  assert.equal(suggestNames('spanish', 'female', [], [rel({ surname: 'García Barcha' })], []).surname, 'Barcha');

  const smith = rel({ sex: 'male', surname: 'Smith', given_name: 'John' });
  assert.deepEqual(suggestNames('western', 'female', [smith], [], [rel({ sex: 'male', surname: 'Brown' })]), { surname: 'Smith', given_name: '', patronymic: '' }, 'a wife keeps her surname, no patronymic');
  assert.deepEqual(suggestNames('eastern', 'female', [rel({ sex: 'male', surname: 'Kim' })], [], []), { surname: 'Kim', given_name: '', patronymic: '' });

  assert.equal(icelandicPatronymic('Jón', 'male'), 'Jónsson');
  assert.equal(icelandicPatronymic('Jón', 'female'), 'Jónsdóttir');
  assert.equal(icelandicPatronymic('Guðmundur', 'male'), 'Guðmundsson');
  assert.equal(icelandicPatronymic('Helgi', 'female'), 'Helgadóttir');
  assert.equal(icelandicPatronymic('Magnús', 'male'), 'Magnússon');
  assert.deepEqual(suggestNames('icelandic', 'female', [rel({ sex: 'male', given_name: 'Sigurður', patronymic: 'Jónsson' })], [], []), { surname: '', given_name: '', patronymic: 'Sigurðsdóttir' });

  // The Russian surname forms and patronymics apply only in the Russian scheme.
  const ozerov = rel({ sex: 'male', surname: 'Озеров', given_name: 'Сергей' });
  assert.deepEqual(suggestNames('russian', 'female', [ozerov], [], []), { surname: 'Озерова', given_name: '', patronymic: 'Сергеевна' });
  assert.deepEqual(suggestNames('western', 'female', [ozerov], [], []), { surname: 'Озеров', given_name: '', patronymic: '' });

  const sibling = rel({ path: 's', surname: 'Smith', given_name: 'Ann', sex: 'female' });
  assert.deepEqual([assumedParent(sibling, 'western', 'new').surname, assumedParent(sibling, 'western', 'new').sex], ['Smith', 'unknown']);
  assert.equal(familyName('García Márquez', 'spanish'), 'García');
  assert.equal(familyName('Озерова', 'western'), 'Озерова');
});

test('file names come from the template', () => {
  const fields = { surname: 'Smith', given_name: 'John', birth_date: 'abt 1890', death_date: '1950-02-01' };
  assert.equal(cardBase(fields, 'deceased', { scheme: 'western', template: '{name} {born}-{died}' }), 'John Smith 1890-1950');
  assert.equal(cardBase(fields, 'deceased', { scheme: 'western', template: '{surname}, {given} ({born}–{died})' }), 'Smith, John (1890–1950)');
  assert.equal(cardBase({ given_name: 'John' }, 'living', { scheme: 'western', template: '{surname}, {given} {born}' }), 'John ?', 'an empty part leaves no stray comma');
  assert.equal(cardBase({ given_name: 'Ann' }, 'living', { scheme: 'western', template: '{given} ({birth_surname})' }), 'Ann', 'empty parentheses are dropped');
  assert.equal(cardBase({ surname: 'A/B', given_name: 'C' }, 'living', { scheme: 'western', template: '{name} {unknown}' }), 'C A B {unknown}', 'unknown placeholders stay, unsafe characters go');
  assert.equal(cardBase({}, 'unknown', { scheme: 'western', template: '{surname}' }), '?');
});

test('«Уточнить» asks only for the name parts of the scheme', () => {
  setLanguage('en');
  const context = { parents: 2, children: 1, hasPhoto: true, lifeStatus: 'living' as const };
  const base = { given_name: 'Jón', sex: 'male', birth_date: '1900' };
  assert.deepEqual(clarifications(base, context, 'icelandic').map((item) => item.text), ['patronymic']);
  assert.deepEqual(clarifications(base, context, 'western').map((item) => item.text), ['surname']);
  assert.deepEqual(clarifications(base, context, 'russian').map((item) => item.text), ['surname', 'patronymic']);
});

test('a card of its own scheme is named and checked by it, not by the vault\'s', () => {
  const garcia = { surname: 'García Barcha', given_name: 'Rodrigo', name_scheme: 'spanish', birth_date: '1959' };
  assert.equal(cardBase(garcia, 'living', { scheme: 'russian', template: '{name} {born}-{died}' }), 'Rodrigo García Barcha 1959-');
  assert.equal(schemeOf('spanish', 'russian'), 'spanish');
  assert.equal(schemeOf(undefined, 'russian'), 'russian');
  assert.equal(schemeOf('klingon', 'russian'), 'russian'); // an unknown value is reported in Проблемы, the vault's scheme applies
  const context = { parents: 2, children: 1, hasPhoto: true, lifeStatus: 'living' as const };
  assert.ok(!clarifications(garcia, context, schemeOf(garcia.name_scheme, 'russian')).some((item) => /отчеств|patronymic/i.test(item.text)));
});

test('a new relative takes the scheme of the father, then the mother, then a child or sibling; never a spouse\'s', () => {
  const father = rel({ sex: 'male', scheme: 'spanish' }), mother = rel({ sex: 'female', scheme: 'western' }), plain = rel({ sex: 'male' });
  assert.equal(inheritedScheme([mother, father], []), 'spanish');
  assert.equal(inheritedScheme([mother, plain], []), 'western');
  assert.equal(inheritedScheme([plain], [rel({ scheme: 'icelandic' })]), 'icelandic');
  assert.equal(inheritedScheme([plain], []), null);
});

test('a birth place suggests the scheme of the country it names, as a whole word', () => {
  assert.equal(schemeByPlace('Madrid, España'), 'spanish');
  assert.equal(schemeByPlace('Буэнос-Айрес, Аргентина'), 'spanish');
  assert.equal(schemeByPlace('Гавана, Куба'), 'spanish');
  assert.equal(schemeByPlace('Краснодар, Кубань'), null);
  assert.equal(schemeByPlace('Reykjavík, Iceland'), 'icelandic');
  assert.equal(schemeByPlace('Budapest, Magyarország'), 'eastern');
  assert.equal(schemeByPlace('Тула, Российская империя'), 'russian');
  assert.equal(schemeByPlace('Boston, USA'), 'western');
  assert.equal(schemeByPlace(''), null);
});

test('the language follows the setting, or Obsidian for «auto»; both languages have every string', () => {
  assert.equal(resolveLanguage('auto', 'ru'), 'ru');
  assert.equal(resolveLanguage('auto', 'en-GB'), 'en');
  assert.equal(resolveLanguage('auto', 'de'), 'en');
  assert.equal(resolveLanguage('ru', 'en'), 'ru');
  setLanguage('en'); assert.equal(language(), 'en');
  const keys = (value: unknown, prefix = ''): string[] => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, item]) => keys(item, `${prefix}${key}.`)) : [prefix];
  assert.deepEqual(keys(STRINGS.ru).sort(), keys(STRINGS.en).sort());
});

test('a GEDCOM file in ANSI is read as Cyrillic or Western European by its letters', () => {
  const cp1251 = new Uint8Array([...Buffer.from('0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME ', 'latin1'), 0xc8, 0xe2, 0xe0, 0xed, 0x20, 0x2f, 0xce, 0xe7, 0xe5, 0xf0, 0xee, 0xe2, 0x2f, 0x0a]);
  assert.equal(ansiCodePage(cp1251), '1251');
  assert.match(decode(cp1251), /Иван \/Озеров\//);
  const cp1252 = new Uint8Array(Buffer.from('0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME Ren\xe9 /M\xfcller/\n', 'latin1'));
  assert.equal(ansiCodePage(cp1252), '1252');
  assert.match(decode(cp1252), /René \/Müller\//);
});

test('PDF text: each letter takes the first font that has it, neutral characters stay in their run', async () => {
  const { fontRuns, isTrueType } = await import('../../src/pdf-text');
  const latin = (code: number) => code < 0x0530;
  const cjk = (code: number) => code >= 0x4e00 && code <= 0x9fff || code === 0x20 || code === 0x31;
  assert.deepEqual(fontRuns('Ivan 李 1', [latin, cjk]).runs, [{ font: 0, text: 'Ivan ' }, { font: 1, text: '李 1' }]);
  assert.deepEqual(fontRuns('毛泽东 (1893)', [latin, cjk]).runs, [{ font: 1, text: '毛泽东 ' }, { font: 0, text: '(1893)' }]);
  assert.deepEqual(fontRuns('Kim 김', [latin, cjk]).missing, ['김']);
  assert.equal(isTrueType(new Uint8Array([0, 1, 0, 0, 9])), true);
  assert.equal(isTrueType(new Uint8Array([...Buffer.from('OTTO')])), false, 'CFF outlines are refused');
  assert.equal(isTrueType(new Uint8Array([...Buffer.from('ttcf')])), false, 'collections are refused');
});
