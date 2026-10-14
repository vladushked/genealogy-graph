import assert from 'node:assert/strict';
import test from 'node:test';
import { isPersonCard, readFields, readPerson, writeFields } from '../../src/schema';
import { lifeYears, yearLabel } from '../../src/model';
import { setLanguage } from '../../src/i18n';

// Messages and labels below are the Russian ones.
setLanguage('ru');

const card = {
  type: 'person', name: 'Озеров Николай Петрович', surname: 'Озеров', birth_date: '1890-02-01', baptism_date: '1890-02-04',
  death_date: '1944-08-15', photo: '[[attachments/a.jpg]]', parents: ['[[Озеров Пётр]]'], children: [], spouses: ['[[Лебедева Анна]]'],
  identity: 'hypothesis', sources: [], 'моё поле': 7,
};

test('a person card is a note with type: person', () => {
  assert.equal(isPersonCard(card), true);
  assert.equal(isPersonCard({ type: 'source' }), false);
  assert.equal(isPersonCard({ 'тип записи': 'предок' }), false);
  assert.equal(isPersonCard(null), false);
});

test('a card reads into fields and a graph view', () => {
  const person = readPerson(card);
  assert.equal(person.name, 'Озеров Николай Петрович');
  assert.equal(person.identity, 'hypothesis');
  assert.equal(person.lifeStatus, 'deceased');
  assert.deepEqual(person.parents, ['[[Озеров Пётр]]']);
  assert.equal(person.photo, '[[attachments/a.jpg]]');
  const { fields } = readFields(card);
  assert.equal(fields.baptism_date, '1890-02-04');
  assert.equal((fields as Record<string, unknown>)['моё поле'], undefined, 'properties outside the schema are not fields');
});

test('life status: stated value first, then a death date, then unknown', () => {
  assert.equal(readPerson({ type: 'person', life_status: 'living', death_date: '1990' }).lifeStatus, 'living');
  assert.equal(readPerson({ type: 'person', death_date: '?' }).lifeStatus, 'deceased');
  assert.equal(readPerson({ type: 'person' }).lifeStatus, 'unknown');
  assert.equal(readPerson({ type: 'person', death_date: '' }).lifeStatus, 'unknown');
  assert.equal(lifeYears('2001', '', 'unknown'), '2001–');
  assert.equal(lifeYears('1915', '', 'deceased'), '1915–?');
  assert.equal(lifeYears('2001', '', 'living'), 'р. 2001');
});

test('enum values outside the schema are reported and kept as written', () => {
  const { fields, unknown } = readFields({ type: 'person', identity: 'не знаю', sex: 'female' });
  assert.equal(fields.identity, 'не знаю');
  assert.deepEqual(unknown, [{ field: 'identity', value: 'не знаю' }]);
});

test('writing marks the card and keeps only schema fields', () => {
  const written = writeFields(readFields(card).fields);
  assert.equal(written.type, 'person');
  assert.equal(written.burial_place, undefined, 'missing fields are not invented');
  for (const [key, value] of Object.entries(card)) if (key !== 'моё поле') assert.deepEqual(written[key], value, key);
});

test('dates: bounds and ranges show a year under the name', () => {
  assert.equal(yearLabel('<1915'), '<1915');
  assert.equal(yearLabel('>1915-03'), '>1915');
  assert.equal(yearLabel('1915..1920'), '1915?');
  assert.equal(yearLabel('1915-03-07?'), '1915?');
  assert.equal(yearLabel('~1915'), '1915?');
});
