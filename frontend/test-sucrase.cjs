const sucrase = require('./node_modules/sucrase');

const tests = [
  "{ a: 'var(--c)' }",
  '{ a: "var(--c)" }',
  '{ a: "val" }',
  "{ a: 'a', b: 'v' }",
  "{ base: 'v', surface: 'v' }",
  '{ primary: "#3584e4" }',
  "{ base: 'var(--base)', surface: 'var(--surface)' }",
];

tests.forEach(t => {
  try {
    sucrase.transform(t, { transforms: ['typescript'] });
    console.log('OK:', t);
  } catch(e) {
    console.log('FAIL:', t, '| col:', e.loc?.column);
  }
});