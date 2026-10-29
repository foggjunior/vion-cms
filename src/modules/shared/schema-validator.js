// Interprets schemas/content.schema.json directly so persisted draft shapes follow the documented schema.
// Only the JSON Schema keywords used by that file are supported; an unknown keyword throws at start-up
// so a schema change cannot silently weaken validation.
const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', '$defs', '$ref', 'oneOf', 'anyOf', 'type', 'const', 'enum',
  'required', 'properties', 'additionalProperties', 'pattern', 'minLength', 'minimum', 'format', 'items'
]);

const FORMATS = {
  uuid: value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  'date-time': value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
};

const TYPE_NAMES = { string: 'text', integer: 'a whole number', number: 'a number', boolean: 'true/false', object: 'an object', array: 'a list', null: 'empty' };

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

const join = (path, key) => (path ? `${path}.${key}` : String(key));

function assertSupported(node, where) {
  if (Array.isArray(node)) { node.forEach((n, i) => assertSupported(n, `${where}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) throw new Error(`Unsupported JSON Schema keyword "${key}" at ${where}`);
  }
  if (node.$defs) for (const [k, v] of Object.entries(node.$defs)) assertSupported(v, `${where}/$defs/${k}`);
  if (node.properties) for (const [k, v] of Object.entries(node.properties)) assertSupported(v, `${where}/properties/${k}`);
  for (const key of ['items', 'oneOf', 'anyOf']) if (node[key]) assertSupported(node[key], `${where}/${key}`);
  if (node.format && !FORMATS[node.format]) throw new Error(`Unsupported format "${node.format}" at ${where}`);
}

export function createSchemaValidator(schema) {
  assertSupported(schema, '#');

  function resolve(ref) {
    if (!ref.startsWith('#/')) throw new Error(`Only local $ref values are supported: ${ref}`);
    const node = ref.slice(2).split('/').reduce((n, key) => (n ? n[key] : undefined), schema);
    if (!node) throw new Error(`Unresolvable $ref ${ref}`);
    return node;
  }

  function check(node, value, path, errors) {
    if (node.$ref) { check(resolve(node.$ref), value, path, errors); return; }
    for (const key of ['oneOf', 'anyOf']) {
      if (!node[key]) continue;
      const results = node[key].map(branch => { const e = []; check(branch, value, path, e); return e; });
      const passing = results.filter(e => e.length === 0).length;
      if (key === 'oneOf' ? passing !== 1 : passing === 0) {
        // Report the branch whose declared type matches the value, which gives the useful message.
        const typed = node[key].map((b, i) => [b.$ref ? resolve(b.$ref) : b, i]).filter(([b]) => !b.type || [].concat(b.type).some(t => matchesType(value, t)));
        if (passing === 0 && typed.length === 1) errors.push(...results[typed[0][1]]);
        else errors.push({ path, message: passing === 0 ? 'does not match any allowed shape' : 'matches more than one allowed shape' });
      }
    }
    if (node.type) {
      const types = [].concat(node.type);
      if (!types.some(t => matchesType(value, t))) {
        errors.push({ path, message: `must be ${types.map(t => TYPE_NAMES[t] || t).join(' or ')}` });
        return;
      }
    }
    if ('const' in node && value !== node.const) errors.push({ path, message: `must be ${JSON.stringify(node.const)}` });
    if (node.enum && !node.enum.includes(value)) errors.push({ path, message: `must be one of: ${node.enum.join(', ')}` });
    if (typeof value === 'string') {
      if (node.minLength != null && value.length < node.minLength) errors.push({ path, message: 'must not be empty' });
      if (node.pattern && !new RegExp(node.pattern, 'u').test(value)) errors.push({ path, message: 'has an invalid format' });
      if (node.format && !FORMATS[node.format](value)) errors.push({ path, message: `must be a valid ${node.format}` });
    }
    if (typeof value === 'number' && node.minimum != null && value < node.minimum) errors.push({ path, message: `must be at least ${node.minimum}` });
    if (typeOf(value) === 'object') {
      for (const key of node.required || []) if (!(key in value)) errors.push({ path: join(path, key), message: 'is required' });
      for (const [key, child] of Object.entries(value)) {
        if (node.properties && key in node.properties) check(node.properties[key], child, join(path, key), errors);
        else if (node.additionalProperties === false) errors.push({ path: join(path, key), message: 'is not an allowed field' });
      }
    }
    if (Array.isArray(value) && node.items) value.forEach((item, i) => check(node.items, item, join(path, i), errors));
  }

  return {
    validate(value, ref = null) {
      const errors = [];
      check(ref ? resolve(ref) : schema, value, '', errors);
      return errors;
    },
    // Validates against the definition for record.kind, which gives clearer messages than the root oneOf.
    validateRecord(record) {
      if (!record || typeof record !== 'object' || !schema.$defs?.[record.kind]) return [{ path: 'kind', message: 'must be destination, accommodation or tour' }];
      return this.validate(record, `#/$defs/${record.kind}`);
    },
    kinds: Object.keys(schema.$defs || {})
  };
}
