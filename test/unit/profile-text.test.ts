import assert from 'node:assert/strict';
import test from 'node:test';
import { ageBetween, ageLabel, bornAs, formatDate, storyText, textValues } from '../../src/profile-text';

test('card dates read as words in Russian and English', () => {
  assert.equal(formatDate('1927-09-27', 'ru'), '27 сентября 1927');
  assert.equal(formatDate('1927-09', 'ru'), 'сентябрь 1927');
  assert.equal(formatDate('1927', 'ru'), '1927');
  assert.equal(formatDate('1915?', 'ru'), 'около 1915');
  assert.equal(formatDate('~1915-03', 'ru'), 'примерно март 1915');
  assert.equal(formatDate('<1915', 'ru'), 'до 1915');
  assert.equal(formatDate('>1915', 'ru'), 'после 1915');
  assert.equal(formatDate('1915..1920', 'ru'), 'между 1915 и 1920');
  assert.equal(formatDate('?', 'ru'), 'дата неизвестна');
  assert.equal(formatDate('', 'ru'), '');
  assert.equal(formatDate('1910-е', 'ru'), '1910-е', 'other notations stay as written');
  assert.equal(formatDate('1927-09-27', 'en'), '27 September 1927');
  assert.equal(formatDate('1915..1920', 'en'), 'between 1915 and 1920');
});

test('age counts full years; with only years it is approximate', () => {
  assert.deepEqual(ageBetween('1927-09-27', '2000-02-16'), { years: 72, approximate: false });
  assert.deepEqual(ageBetween('2004-02-09', '2026-10-13'), { years: 22, approximate: false });
  assert.deepEqual(ageBetween('1898', '1943'), { years: 45, approximate: true });
  assert.equal(ageBetween('1915?', '1980'), null);
  assert.equal(ageLabel({ years: 22, approximate: false }, 'ru'), '22 года');
  assert.equal(ageLabel({ years: 45, approximate: true }, 'ru'), 'около 45 лет');
  assert.equal(ageLabel({ years: 71, approximate: false }, 'ru'), '71 год');
  assert.equal(ageLabel({ years: 12, approximate: false }, 'ru'), '12 лет');
  assert.equal(ageLabel({ years: 1, approximate: true }, 'en'), 'about 1 year');
});

test('birth surname by sex, values without wiki-link brackets', () => {
  assert.equal(bornAs('Мельникова', 'female', 'ru'), 'урождённая Мельникова');
  assert.equal(bornAs('Smith', 'female', 'en'), 'née Smith');
  assert.deepEqual(textValues(['1926, [[Ивановка]]', '[[Места/Москва|Москва]]', '', null]), ['1926, Ивановка', 'Москва']);
  assert.deepEqual(textValues(1915), ['1915']);
});

test('an imported note with only a heading and an empty item has no story; a portrait embed alone neither', () => {
  assert.equal(storyText('\n## Из «Озеровы Соколовы.at5»\n\n- \n'), null);
  assert.equal(storyText('![[files/photo.png]]\n', ['files/photo.png']), null);
  assert.equal(storyText('## Из «Древа»\n\n- Место: Байдеряково\n'), '## Из «Древа»\n\n- Место: Байдеряково');
});
