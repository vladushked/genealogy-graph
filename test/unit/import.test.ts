import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { readAt5 } from '../../src/import/at5';
import { ImportError, type ImportedPerson, type ImportedTree } from '../../src/import/types';
import { completion, familyName, planImport, sourceRecord, type PlanOptions } from '../../src/import/plan';
import { familyLine, type LinePerson } from '../../src/names';
import { setLanguage } from '../../src/i18n';

// Messages and labels below are the Russian ones.
setLanguage('ru');

/** A tiny «Древо Жизни 5» database with the tables, field ids and role ids the reader relies on. */
async function at5(build: (run: (sql: string) => void) => void): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const run = (sql: string) => db.run(sql);
  run(`CREATE TABLE Global (id, guid); CREATE TABLE Persons (id, db_id, sex, lifespan, birth_id, birth_db_id, death_id, death_db_id, isfav);
    CREATE TABLE Events (id, db_id, et_id, et_db_id, isfav, alive); CREATE TABLE EventTypes (id, db_id, namelocale, gedname);
    CREATE TABLE EventRoles (id, db_id, et_id, et_db_id, ord, roletype, ismain); CREATE TABLE EventDetails (id, db_id, p_id, p_db_id, e_id, e_db_id, er_id, er_db_id);
    CREATE TABLE ValuesStr (f_id, f_db_id, rec_id, rec_db_id, rec_table, lang_id, vstr, vblob); CREATE TABLE ValuesDates (f_id, f_db_id, rec_id, rec_db_id, rec_table, d, m, y, d2, m2, y2, type);
    CREATE TABLE ValuesLinks (f_id, f_db_id, rec_id, rec_db_id, rec_table, vlink_id, vlink_db_id, vlink_table); CREATE TABLE Documents (id, db_id, path);
    CREATE TABLE DocumentDetails (id, db_id, d_id, d_db_id, rec_id, rec_db_id, rec_table, d_ord, r_ord); CREATE TABLE __Recs (rec_guid, rec_id, rec_db_id, rec_table);
    INSERT INTO Global VALUES (0, 9223372036854775807);
    INSERT INTO EventTypes VALUES (1,0,41,'BIRT'), (2,0,42,'DEAT'), (3,0,43,'MARR'), (4,0,44,'DIV'), (8,0,48,'ADOP');
    INSERT INTO EventRoles VALUES (1,0,1,0,1,1,1), (2,0,1,0,2,2,0), (3,0,1,0,3,2,0), (4,0,2,0,1,0,1), (5,0,3,0,1,2,1), (6,0,3,0,2,2,1),
      (7,0,4,0,1,3,1), (8,0,4,0,2,3,1), (9,0,8,0,1,1,1), (10,0,8,0,2,2,0), (11,0,8,0,3,2,0);`);
  build(run);
  return db.export();
}
const person = (run: (sql: string) => void, id: number, sex: number, surname: string, given: string, patronymic: string, other?: string) => {
  run(`INSERT INTO Persons (id, db_id, sex) VALUES (${id}, 0, ${sex}); INSERT INTO __Recs VALUES (10000000000000000${String(id).padStart(2, '0')}, ${id}, 0, 13);
    INSERT INTO ValuesStr VALUES (64,0,${id},0,13,2,'${surname}',NULL), (66,0,${id},0,13,2,'${given}',NULL), (67,0,${id},0,13,2,'${patronymic}',NULL)`);
  if (other) run(`INSERT INTO ValuesStr VALUES (65,0,${id},0,13,2,'${other}',NULL)`);
};
const event = (run: (sql: string) => void, id: number, type: number, alive: number | null, people: Array<[number, number]>, date?: [number | null, number | null, number]) => {
  run(`INSERT INTO Events VALUES (${id}, 0, ${type}, 0, 0, ${alive ?? 'NULL'})`);
  people.forEach(([p, role], index) => run(`INSERT INTO EventDetails VALUES (${id * 10 + index}, 0, ${p}, 0, ${id}, 0, ${role}, 0)`));
  if (date) run(`INSERT INTO ValuesDates VALUES (29, 0, ${id}, 0, 7, ${date[0] ?? 'NULL'}, ${date[1] ?? 'NULL'}, ${date[2]}, NULL, NULL, NULL, 0)`);
  if (type === 1) for (const [p, role] of people) if (role === 1) run(`UPDATE Persons SET birth_id = ${id} WHERE id = ${p}`);
  if (type === 2) for (const [p] of people) run(`UPDATE Persons SET death_id = ${id} WHERE id = ${p}`);
};

/** Ivan + Maria (divorced later) → Petr; Petr was adopted by Oleg; Ivan died, date unknown; Maria has a portrait. */
const family = () => at5((run) => {
  person(run, 1, 1, 'Иванов', 'Иван', 'Петрович');
  person(run, 2, 2, 'Иванова', 'Мария', 'Сергеевна', 'Смирнова');
  person(run, 3, 1, 'Иванов', 'Пётр', 'Иванович');
  person(run, 4, 1, 'Орлов', 'Олег', 'Олегович');
  event(run, 10, 1, 0, [[1, 1]], [null, null, 1950]);
  event(run, 11, 1, 1, [[2, 1]], [null, 3, 1952]);
  event(run, 12, 1, 1, [[3, 1], [1, 2], [2, 3]], [7, 5, 1975]);
  event(run, 13, 2, null, [[1, 4]]);
  event(run, 14, 3, null, [[1, 5], [2, 6]]);
  event(run, 15, 4, null, [[1, 7], [2, 8]]);
  event(run, 16, 8, 1, [[3, 9], [4, 10]]);
  run(`INSERT INTO Documents VALUES (5, 0, 'Мария.jpg'); INSERT INTO ValuesLinks VALUES (68, 0, 2, 0, 13, 5, 0, 4)`);
});

test('AT5: people, roles, dates, life status, adoption, divorce and portrait are read', async () => {
  const tree = readAt5(await family(), await initSqlJs());
  assert.equal(tree.sourceId, '9223372036854775807', '64-bit ids keep every digit');
  assert.equal(tree.people.length, 4);
  const by = (given: string) => tree.people.find((p) => p.givenName === given)!;
  assert.equal(by('Иван').deathDate, '?');
  assert.equal(by('Иван').lifeStatus, 'deceased');
  assert.equal(by('Мария').birthDate, '1952-03');
  assert.equal(by('Мария').birthSurname, 'Смирнова');
  assert.equal(by('Мария').media[0], 'doc5');
  assert.equal(by('Пётр').birthDate, '1975-05-07');
  assert.equal(by('Пётр').lifeStatus, 'living');
  assert.equal(by('Олег').lifeStatus, 'unknown');
  assert.equal(by('Пётр').key, '1000000000000000003');
  assert.equal(tree.parents.filter((p) => p.child === by('Пётр').key && !p.adoptive).length, 2);
  assert.deepEqual(tree.parents.filter((p) => p.adoptive).map((p) => p.parent), [by('Олег').key]);
  assert.equal(tree.spouses.length, 1);
  assert.equal(tree.spouses[0].divorced, true);
});

test('AT5: damaged or foreign files are refused with a clear message', async () => {
  const SQL = await initSqlJs();
  assert.throws(() => readAt5(new Uint8Array(4096), SQL), (error) => error instanceof ImportError && /нулями/.test(error.message));
  assert.throws(() => readAt5(new TextEncoder().encode('# Не база'), SQL), (error) => error instanceof ImportError && /SQLite/.test(error.message));
  const other = new SQL.Database(); other.run('CREATE TABLE notes (text)');
  assert.throws(() => readAt5(other.export(), SQL), (error) => error instanceof ImportError && /нет таблиц/.test(error.message));
  assert.throws(() => readAt5(new Uint8Array(0), SQL), (error) => error instanceof ImportError && /пуст/.test(error.message));
});

const imported = (fields: Partial<ImportedPerson> & Pick<ImportedPerson, 'key' | 'sex' | 'lifeStatus'>): ImportedPerson => ({
  nameVariants: [], occupations: [], education: [], military: [], residences: [], citations: [], notes: [], media: [], ...fields,
});
const tree = (): ImportedTree => ({
  format: 'test', sourceId: 'db', warnings: [], media: [{ key: 'm1', path: 'фото.jpg' }], godparents: [{ child: 'c1', godparent: 'gp' }],
  people: [
    imported({ key: 'gp', sex: 'male', surname: 'Озеров', givenName: 'Николай', patronymic: 'Петрович', birthDate: '1932', deathDate: '2003', lifeStatus: 'deceased', burialPlace: 'Калуга, Пятницкое кладбище' }),
    imported({ key: 'f', sex: 'male', surname: 'Озеров', givenName: 'Олег', patronymic: 'Николаевич', birthDate: '1968-04-17', lifeStatus: 'living', notes: ['Играл в шахматы'], media: ['m1'], residences: ['1983, Обнинск'], occupations: ['агроном'] }),
    imported({ key: 'm', sex: 'female', surname: 'Озерова', birthSurname: 'Кравченко', givenName: 'Светлана', patronymic: 'Борисовна', birthDate: '1975', lifeStatus: 'living', citations: ['Метрическая книга, л. 3'] }),
    imported({ key: 'c1', sex: 'male', surname: 'Озеров', givenName: 'Иван', patronymic: 'Олегович', birthDate: '1999', lifeStatus: 'living' }),
    imported({ key: 'c2', sex: 'male', surname: 'Озеров', givenName: 'Иван', patronymic: 'Олегович', birthDate: '1999', lifeStatus: 'living' }),
    imported({ key: 'x', sex: 'female', givenName: 'Анна', lifeStatus: 'unknown' }),
  ],
  parents: [{ child: 'f', parent: 'gp' }, { child: 'c1', parent: 'f' }, { child: 'c1', parent: 'm' }, { child: 'c2', parent: 'f' }, { child: 'm', parent: 'c1' }],
  spouses: [{ a: 'f', b: 'm', marriageDate: '1997-08-23', marriagePlace: 'Ярославль', divorced: true, divorceDate: '2008' }],
});
const options = (extra: Partial<PlanOptions> = {}): PlanOptions => ({ folderMode: 'family', folder: '', filesFolder: 'files', sourceName: 'семья.at5', sourceLabel: '«Древо Жизни»', existingPaths: new Set(), ...extra });

test('new cards: names, family folders, links, photo, source record; namesakes get distinct names', () => {
  const plan = planImport(tree(), [], options());
  const card = (key: string) => plan.cards.find((c) => c.key === key)!;
  assert.equal(card('f').path, 'Озеровы/Озеров Олег Николаевич 1968-.md');
  assert.equal(card('m').path, 'Кравченко/Озерова Светлана Борисовна (Кравченко) 1975-.md', 'a woman goes by her birth surname, however small its line');
  const married = planImport({ ...tree(), people: [...tree().people, imported({ key: 'k', sex: 'male', surname: 'Кадыков', givenName: 'Самсон', lifeStatus: 'unknown' }), imported({ key: 'k1', sex: 'male', givenName: 'Сын', lifeStatus: 'unknown' })],
    spouses: [...tree().spouses, { a: 'k', b: 'm' }], parents: [...tree().parents, { child: 'k1', parent: 'k' }] }, [], options());
  assert.equal(married.cards.find((c) => c.key === 'k')!.path.split('/')[0], 'Кадыковы', 'a man of a small line keeps his own folder');
  assert.equal(married.cards.find((c) => c.key === 'k1')!.path.split('/')[0], 'Кадыковы', 'without a surname: the folder of the father');
  assert.equal(card('gp').path, 'Озеровы/Озеров Николай Петрович 1932-2003.md');
  assert.notEqual(card('c1').path, card('c2').path);
  assert.deepEqual(plan.namesakes, [['c1', 'c2']]);
  assert.equal(card('x').path, 'Без фамилии/Анна ?-?.md');
  assert.deepEqual(card('f').fields.children, ['[[Озеров Иван Олегович 1999-]]', `[[${card('c2').path.split('/').pop()!.replace(/\.md$/, '')}]]`]);
  assert.equal(card('f').fields.photo, '[[files/фото.jpg]]');
  assert.equal(card('f').fields.source_record, sourceRecord(tree(), 'f'));
  assert.equal(card('f').fields.life_status, 'living');
  assert.match(card('f').body, /Играл в шахматы/);
  assert.deepEqual(card('f').fields.residences, ['1983, Обнинск']);
  assert.equal(card('f').fields.occupation, 'агроном');
  assert.deepEqual(card('f').fields.marriages, ['[[Озерова Светлана Борисовна (Кравченко) 1975-]]: брак 1997-08-23, Ярославль; развод 2008']);
  assert.deepEqual(card('c1').fields.godparents, ['[[Озеров Николай Петрович 1932-2003]]']);
  assert.equal(card('gp').fields.burial_place, 'Калуга, Пятницкое кладбище');
  assert.deepEqual(card('m').fields.sources, ['«Древо Жизни»: семья.at5', 'Метрическая книга, л. 3']);
  assert.equal('generation' in card('f').fields, false, 'generations are computed by the graph, not written');
  assert.deepEqual(plan.media, [{ key: 'm1', source: 'фото.jpg', target: 'files/фото.jpg' }]);
  assert.equal(familyName('Бельская', 'russian'), 'Бельские');
  assert.equal(familyName('Кравченко', 'russian'), 'Кравченко');
});

test('family line: women by birth surname, men by surname, no surname — father, mother, husband', () => {
  const people: Record<string, LinePerson<string>> = {
    father: { sex: 'male', surname: 'Озеров', parents: [], spouses: ['mother'] },
    mother: { sex: 'female', surname: 'Озерова', birthSurname: 'Кравченко', parents: [], spouses: ['father'] },
    son: { sex: 'male', parents: ['mother', 'father'], spouses: [] },
    orphan: { sex: 'female', parents: ['mother'], spouses: [] },
    wife: { sex: 'female', parents: [], spouses: ['father'] },
    nobody: { sex: 'unknown', parents: ['ghost'], spouses: [] },
  };
  const line = (key: string) => familyLine(key, (person) => people[person], 'russian');
  assert.equal(line('father'), 'Озеровы');
  assert.equal(line('mother'), 'Кравченко');
  assert.equal(line('son'), 'Озеровы', 'the father first, whatever the order');
  assert.equal(line('orphan'), 'Кравченко');
  assert.equal(line('wife'), 'Озеровы');
  assert.equal(line('nobody'), null);
});

test('existing cards: matched by source record or by name + birth year, completed without overwriting', () => {
  const existing = [
    { path: 'Озеровы/Олег.md', fields: { surname: 'Озеров', given_name: 'Олег', patronymic: 'Николаевич', birth_date: '1968-04-17', birth_place: 'Калуга', children: ['[[Сын]]'] } },
    { path: 'Дед.md', fields: { source_record: sourceRecord(tree(), 'gp'), death_date: '2004' } },
    { path: 'Иван 1.md', fields: { surname: 'Озеров', given_name: 'Иван', patronymic: 'Олегович' } },
  ];
  const plan = planImport(tree(), existing, options({ existingPaths: new Set(existing.map((card) => card.path)) }));
  const update = (path: string) => plan.cards.find((c) => c.path === path)!;
  assert.equal(update('Озеровы/Олег.md').action, 'update');
  assert.deepEqual(update('Озеровы/Олег.md').fields.children, ['[[Сын]]', '[[Озеров Иван Олегович 1999-]]', `[[${plan.cards.find((c) => c.key === 'c2')!.path.split('/').pop()!.replace(/\.md$/, '')}]]`]);
  assert.equal(update('Озеровы/Олег.md').fields.birth_place, undefined, 'a filled field is never replaced');
  assert.deepEqual(update('Дед.md').conflicts.map((c) => c.field), ['death_date']);
  assert.deepEqual(plan.ambiguous.map((a) => a.key).sort(), ['c1', 'c2'], 'no birth year on the existing card: the user decides');
  const namesake = planImport(tree(), [...existing, { path: 'Олег без года.md', fields: { surname: 'Озеров', given_name: 'Олег', patronymic: 'Николаевич' } }], options());
  assert.equal(namesake.cards.find((c) => c.key === 'f')!.path, 'Озеровы/Олег.md', 'a namesake without a year does not block a same-year match');
  const otherYear = planImport({ ...tree(), people: tree().people.map((p) => p.key === 'f' ? { ...p, birthDate: '1925' } : p) }, existing, options());
  assert.equal(otherYear.ambiguous.some((a) => a.key === 'f'), false, 'a card with another known birth year is not a candidate');
  const decided = planImport(tree(), existing, options({ decisions: { c1: 'Иван 1.md', c2: null }, existingPaths: new Set(existing.map((card) => card.path)) }));
  assert.equal(decided.ambiguous.length, 0);
  assert.equal(decided.cards.find((c) => c.key === 'c1')!.path, 'Иван 1.md');
});

test('re-importing what was written changes nothing', () => {
  const first = planImport(tree(), [], options());
  const written = first.cards.map((card) => ({ path: card.path, fields: card.fields }));
  const again = planImport(tree(), written, options({ existingPaths: new Set(written.map((card) => card.path)) }));
  assert.equal(again.counts.create, 0);
  assert.equal(again.counts.update, 0);
  assert.equal(again.counts.unchanged, tree().people.length);
});

test('completion only adds missing values and list entries', () => {
  const { patch, conflicts } = completion({ spouses: ['[[A]]'], birth_date: '1900' }, { spouses: ['[[a]]', '[[B]]'], birth_date: '1901', death_date: '1950' });
  assert.deepEqual(patch, { spouses: ['[[A]]', '[[B]]'], death_date: '1950' });
  assert.deepEqual(conflicts, [{ field: 'birth_date', existing: '1900', imported: '1901' }]);
});

test('names of namesakes stay valid link targets: no square brackets', () => {
  const plan = planImport(tree(), [], options());
  for (const card of plan.cards) assert.doesNotMatch(card.path, /[[\]|#^]/, card.path);
});
