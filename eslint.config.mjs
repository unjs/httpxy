import unjs from "eslint-config-unjs";

// https://github.com/unjs/eslint-config
export default unjs({
  ignores: [],
  rules: {
  "unicorn/consistent-function-scoping": 0,
  "@typescript-eslint/no-unused-vars": 0
},
});