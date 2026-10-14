import assert from 'node:assert/strict';
import test from 'node:test';
import { decode, gedcomDate, parseLines, readGedcom } from '../../src/import/gedcom';
import { planImport } from '../../src/import/plan';
import { ImportError } from '../../src/import/types';
import { setLanguage } from '../../src/i18n';

// Messages and labels below are the Russian ones.
setLanguage('ru');

/** A small family in GEDCOM 5.5.1 with the shapes real exports use. */
const FAMILY = `0 HEAD
1 SOUR TestTree
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
1 FILE family.ged
0 @I1@ INDI
1 NAME Николай Петрович /Озеров/
1 SEX M
1 BIRT
2 DATE ABT 1890
2 PLAC Тверская губ., Кашинский уезд, с. Ильинское
2 SOUR @S1@
3 PAGE л. 12 об.
1 CHR
2 DATE 4 FEB 1890
2 PLAC Ильинская церковь
2 ASSO @I4@
3 ROLE GODP
1 DEAT
2 DATE BET 1941 AND 1945
2 CAUS пропал без вести
1 OCCU крестьянин-хлебопашец
1 OCCU плотник
2 DATE FROM 1920 TO 1930
1 RESI
2 DATE 1926
2 PLAC д. Ивановка
1 RELI православный
1 CAST крестьянин
1 _MILT рядовой, 1081 сп
2 DATE 1941
1 NOTE Ушёл на фронт в июле 1941.
2 CONT Последнее письмо — из-под Ржева,
2 CONC  в 1942 году.
1 NOTE @N1@
1 OBJE @O1@
1 OBJE
2 FILE C:\\Users\\old\\Фото\\Николай.jpg
2 TITL Портрет
2 _PRIM Y
1 _UPD 1 JAN 2020
1 FAMS @F1@
0 @I2@ INDI
1 NAME Анна Ивановна /Лебедева/
2 TYPE birth
1 NAME Анна /Озерова/
2 TYPE married
1 SEX F
1 BIRT
2 DATE BEF 1895
1 BURI
2 PLAC Ильинское кладбище
1 FAMS @F1@
0 @I3@ INDI
1 NAME Пётр /Озеров/
2 GIVN Пётр Николаевич
2 SURN Озеров
1 SEX M
1 BIRT
2 DATE 7 MAR 1915
1 EVEN
2 TYPE Military service
2 DATE 1937
1 EDUC Тверской техникум
1 FAMC @F1@
2 PEDI birth
0 @I4@ INDI
1 NAME Фёдор Иванович /Лебедев/
1 SEX M
0 @I5@ INDI
1 NAME Мария /Озерова/
1 SEX F
1 FAMC @F1@
2 PEDI adopted
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I5@
1 CHIL @I9@
1 MARR
2 DATE 12 OCT 1912
2 PLAC с. Ильинское
1 DIV
1 NOTE Венчались в Ильинской церкви.
0 @N1@ NOTE Сведения записаны со слов внучки.
0 @S1@ SOUR
1 TITL Метрическая книга Ильинской церкви, 1890
0 @O1@ OBJE
1 FILE docs/метрика.pdf
2 FORM pdf
0 TRLR
`;

test('GEDCOM: names, patronymics and maiden names', () => {
  const tree = readGedcom(new TextEncoder().encode(FAMILY), 'family.ged');
  const by = (key: string) => tree.people.find((person) => person.key === key)!;
  assert.deepEqual([by('I1').surname, by('I1').givenName, by('I1').patronymic], ['Озеров', 'Николай', 'Петрович']);
  assert.deepEqual([by('I3').givenName, by('I3').patronymic], ['Пётр', 'Николаевич'], 'patronymic split off GIVN');
  assert.deepEqual([by('I2').surname, by('I2').birthSurname, by('I2').givenName, by('I2').patronymic], ['Озерова', 'Лебедева', 'Анна', 'Ивановна']);
  assert.deepEqual(by('I2').nameVariants, ['Озерова Анна']);
  assert.equal(tree.sourceId, 'TestTree:family.ged');
});

test('GEDCOM: events, facts, notes and sources', () => {
  const tree = readGedcom(new TextEncoder().encode(FAMILY), 'family.ged');
  const nikolai = tree.people.find((person) => person.key === 'I1')!;
  assert.equal(nikolai.birthDate, '1890?');
  assert.equal(nikolai.birthPlace, 'Тверская губ., Кашинский уезд, с. Ильинское');
  assert.deepEqual([nikolai.baptismDate, nikolai.baptismPlace], ['1890-02-04', 'Ильинская церковь']);
  assert.deepEqual([nikolai.deathDate, nikolai.causeOfDeath, nikolai.lifeStatus], ['1941..1945', 'пропал без вести', 'deceased']);
  assert.deepEqual(nikolai.occupations, ['крестьянин-хлебопашец', 'плотник, 1920..1930']);
  assert.deepEqual(nikolai.residences, ['1926, д. Ивановка']);
  assert.deepEqual([nikolai.religion, nikolai.socialStatus], ['православный', 'крестьянин']);
  assert.deepEqual(nikolai.military, ['рядовой, 1081 сп, 1941']);
  assert.deepEqual(nikolai.citations, ['Метрическая книга Ильинской церкви, 1890, л. 12 об.']);
  assert.ok(nikolai.notes.includes('Ушёл на фронт в июле 1941.\nПоследнее письмо — из-под Ржева, в 1942 году.'), 'CONT starts a line, CONC continues it');
  assert.ok(nikolai.notes.includes('Сведения записаны со слов внучки.'), 'shared notes are resolved');
  assert.ok(nikolai.notes.includes('Семья: Венчались в Ильинской церкви.'));
  assert.equal(nikolai.notes.some((note) => /UPD/.test(note)), false, 'program bookkeeping is skipped');
  const anna = tree.people.find((person) => person.key === 'I2')!;
  assert.deepEqual([anna.birthDate, anna.burialPlace, anna.lifeStatus], ['<1895', 'Ильинское кладбище', 'deceased']);
  const petr = tree.people.find((person) => person.key === 'I3')!;
  assert.deepEqual([petr.birthDate, petr.military, petr.education, petr.lifeStatus], ['1915-03-07', ['1937'], ['Тверской техникум'], 'unknown']);
});

test('GEDCOM: families, adoption, godparents and media', () => {
  const tree = readGedcom(new TextEncoder().encode(FAMILY), 'family.ged');
  assert.deepEqual(tree.parents, [
    { child: 'I3', parent: 'I1' }, { child: 'I3', parent: 'I2' },
    { child: 'I5', parent: 'I1', adoptive: true }, { child: 'I5', parent: 'I2', adoptive: true },
  ]);
  assert.deepEqual(tree.spouses, [{ a: 'I1', b: 'I2', marriageDate: '1912-10-12', marriagePlace: 'с. Ильинское', divorced: true, divorceDate: undefined }]);
  assert.deepEqual(tree.godparents, [{ child: 'I1', godparent: 'I4' }]);
  const nikolai = tree.people.find((person) => person.key === 'I1')!;
  assert.deepEqual(nikolai.media, ['I1-2', '@O1@'], 'the primary picture is the portrait');
  assert.deepEqual(tree.media.map((item) => item.path).sort(), ['C:\\Users\\old\\Фото\\Николай.jpg', 'docs/метрика.pdf']);
  assert.ok(tree.warnings.some((warning) => /отсутствующие записи: 1/.test(warning)), 'CHIL @I9@ points nowhere');
});

test('GEDCOM: the tree becomes cards with the shared import plan', () => {
  const tree = readGedcom(new TextEncoder().encode(FAMILY), 'family.ged');
  const plan = planImport(tree, [], { folderMode: 'single', folder: 'Импорт', filesFolder: 'files', sourceName: 'family.ged', sourceLabel: 'GEDCOM', existingPaths: new Set() });
  const card = plan.cards.find((item) => item.key === 'I1')!;
  assert.equal(card.path, 'Импорт/Озеров Николай Петрович 1890-1941.md');
  assert.equal(card.fields.photo, '[[files/Николай.jpg]]');
  assert.deepEqual(card.fields.occupation, ['крестьянин-хлебопашец', 'плотник, 1920..1930']);
  assert.deepEqual(card.fields.godparents, ['[[Лебедев Фёдор Иванович ?-?]]']);
  assert.deepEqual(card.fields.sources, ['GEDCOM: family.ged', 'Метрическая книга Ильинской церкви, 1890, л. 12 об.']);
  assert.match(card.body, /Последнее письмо/);
  assert.deepEqual(plan.cards.find((item) => item.key === 'I5')!.fields.adoptive_parents?.toString(), '[[Озеров Николай Петрович 1890-1941]],[[Озерова Анна Ивановна (Лебедева) 1895-?]]');
});

test('GEDCOM dates', () => {
  const cases: Array<[string, string | undefined]> = [
    ['7 MAR 1915', '1915-03-07'], ['MAR 1915', '1915-03'], ['1915', '1915'], ['ABT 1915', '1915?'], ['EST 3 JAN 1915', '1915-01-03?'],
    ['CAL 1915', '1915?'], ['BEF 1915', '<1915'], ['AFT 1915', '>1915'], ['BET 1915 AND 1920', '1915..1920'], ['FROM 1915 TO 1920', '1915..1920'],
    ['@#DJULIAN@ 25 OCT 1917', '1917-10-25'], ['JULIAN 25 OCT 1917', '1917-10-25'], ['INT 1915 (по словам дочери)', '1915'],
    ['(в годы войны)', 'в годы войны'], ['11 FEB 1731/32', '1731-02-11'], ['', undefined], ['весной 1915', 'весной 1915'],
  ];
  for (const [input, expected] of cases) assert.equal(gedcomDate(input), expected, input);
  const warnings = new Set<string>();
  assert.equal(gedcomDate('@#DHEBREW@ 1 TSH 5680', warnings), '@#DHEBREW@ 1 TSH 5680');
  assert.equal(warnings.size, 1);
});

test('GEDCOM encodings: BOM, UTF-16, Windows-1251', () => {
  const text = '0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME Иван /Озеров/\n0 TRLR\n';
  const cp1251 = Uint8Array.from([...text].map((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code;
  }));
  assert.equal(decode(cp1251), text);
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8])]);
  assert.equal(decode(utf16), text);
  assert.equal(decode(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])), text);
  assert.equal(readGedcom(cp1251).people[0].surname, 'Озеров');
});

test('GEDCOM: broken lines are counted, foreign files refused', () => {
  const { records, skipped } = parseLines('0 HEAD\nмусор\n1 SOUR X\n3 DATE 1900\n0 TRLR');
  assert.equal(records.length, 2);
  assert.equal(skipped, 2);
  assert.throws(() => readGedcom(new TextEncoder().encode('просто текст')), (error) => error instanceof ImportError && /не файл GEDCOM/.test(error.message));
  assert.throws(() => readGedcom(new Uint8Array(0)), (error) => error instanceof ImportError && /пуст/.test(error.message));
});
