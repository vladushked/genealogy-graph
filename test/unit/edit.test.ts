import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLink, cardBase, clarifications, DEFAULT_FILE_NAME, removeLink } from '../../src/edit';
import { setLanguage } from '../../src/i18n';
import { assumedParent as assume, fatherName, genderSurname, patronymicOf, suggestNames as suggest, type Relative } from '../../src/names';
import type { Sex } from '../../src/schema';

setLanguage('ru');
const ru = { scheme: 'russian' as const, template: DEFAULT_FILE_NAME };
const suggestNames = (sex: Sex, parents: Relative[], children: Relative[], spouses: Relative[]) => suggest('russian', sex, parents, children, spouses);
const assumedParent = (sibling: Relative) => assume(sibling, 'russian', 'new');

test('patronymics both ways', () => {
  const pairs: Array<[string, string, string]> = [
    ['Иван', 'Иванович', 'Ивановна'], ['Сергей', 'Сергеевич', 'Сергеевна'], ['Василий', 'Васильевич', 'Васильевна'],
    ['Дмитрий', 'Дмитриевич', 'Дмитриевна'], ['Игорь', 'Игоревич', 'Игоревна'], ['Никита', 'Никитич', 'Никитична'],
    ['Илья', 'Ильич', 'Ильинична'], ['Михаил', 'Михайлович', 'Михайловна'], ['Андрей', 'Андреевич', 'Андреевна'],
  ];
  for (const [name, male, female] of pairs) {
    { assert.equal(patronymicOf(name, 'male'), male); assert.equal(patronymicOf(name, 'female'), female); }
    { assert.equal(fatherName(male), name, male); assert.equal(fatherName(female), name, female); }
  }
  assert.equal(patronymicOf('Иван', 'unknown'), '');
});

test('surname forms', () => {
  assert.equal(genderSurname('Озеров', 'female'), 'Озерова');
  assert.equal(genderSurname('Озерова', 'male'), 'Озеров');
  assert.equal(genderSurname('Бельский', 'female'), 'Бельская');
  assert.equal(genderSurname('Бельская', 'male'), 'Бельский');
  assert.equal(genderSurname('Кравченко', 'female'), 'Кравченко');
});

const rel = (over: Partial<Relative>): Relative => ({ path: 'x', name: 'x', sex: 'unknown', scheme: null, surname: '', given_name: '', patronymic: '', birth_surname: '', parents: [], children: [], spouses: [], ...over });

test('name hints', () => {
  const father = rel({ sex: 'male', surname: 'Озеров', given_name: 'Сергей' });
  assert.deepEqual(suggestNames('female', [father], [], []), { surname: 'Озерова', given_name: '', patronymic: 'Сергеевна' });
  const child = rel({ surname: 'Озерова', patronymic: 'Михайловна' });
  assert.deepEqual(suggestNames('male', [], [child], []), { surname: 'Озеров', given_name: 'Михаил', patronymic: '' });
  const husband = rel({ sex: 'male', surname: 'Иванов' });
  assert.equal(suggestNames('female', [father], [], [husband]).surname, 'Иванова');
});

test('file name', () => {
  assert.equal(cardBase({ surname: 'Озеров', given_name: 'Антон', patronymic: 'Сергеевич', birth_date: '1985-03-01' }, 'living', ru), 'Озеров Антон Сергеевич 1985-');
  assert.equal(cardBase({ surname: 'Иванова', given_name: 'Мария', birth_surname: 'Петрова' }, 'unknown', ru), 'Иванова Мария (Петрова) ?-?');
  assert.equal(cardBase({ surname: 'Иванов', birth_date: '<1850', death_date: '1880..1885' }, 'deceased', ru), 'Иванов 1850-1880');
});

test('links and clarifications', () => {
  const same = (ref: string) => ref === 'A';
  assert.deepEqual(addLink('[[A]]', '[[A]]', same), ['[[A]]']);
  assert.deepEqual(addLink(['[[B]]'], '[[A]]', same), ['[[B]]', '[[A]]']);
  assert.deepEqual(removeLink(['[[A|x]]', '[[B]]'], same), ['[[B]]']);
  const full = { surname: 'А', given_name: 'Б', patronymic: 'В', sex: 'male', birth_date: '1900', death_date: '1950' };
  assert.deepEqual(clarifications(full, { parents: 2, children: 1, hasPhoto: true, lifeStatus: 'deceased' }), []);
  assert.deepEqual(clarifications({ ...full, identity: 'hypothesis', questions: ['кто отец?'] }, { parents: 2, children: 1, hasPhoto: true, lifeStatus: 'deceased' }).map((item) => item.text), ['гипотеза', 'вопрос: кто отец?']);
  assert.deepEqual(clarifications({ given_name: 'Б', death_date: '?' }, { parents: 1, children: 0, hasPhoto: false, lifeStatus: 'deceased' }).map((item) => item.text),
    ['фамилия', 'отчество', 'пол', 'второй родитель', 'дети', 'дата рождения', 'дата смерти', 'фото']);
});

test('assumed common parent of a sibling', () => {
  const sibling = rel({ path: 's', surname: 'Яковлева', birth_surname: '', patronymic: 'Петровна', sex: 'female' });
  const parent = assumedParent(sibling);
  assert.deepEqual([parent.sex, parent.surname, parent.given_name], ['male', 'Яковлев', 'Пётр']);
  assert.deepEqual(suggestNames('male', [parent], [], []), { surname: 'Яковлев', given_name: '', patronymic: 'Петрович' });
  const daughter = rel({ surname: 'Яковлева', birth_surname: 'Озерова', patronymic: 'Михайловна' });
  assert.equal(suggestNames('male', [], [daughter], []).surname, 'Озеров');
});
