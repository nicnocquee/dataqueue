export const toCamelCase = (str: string) => {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

export const toSnakeCase = (str: string) => {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
};

export const objectKeysToCamelCase = (obj: Record<string, any>) => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [toCamelCase(key), value]),
  );
};

export const objectKeysToSnakeCase = (obj: Record<string, any>) => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [toSnakeCase(key), value]),
  );
};
