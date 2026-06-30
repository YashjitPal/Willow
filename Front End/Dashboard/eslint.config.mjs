import reactHooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';

export default [{
  plugins: { 'react-hooks': reactHooks },
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: { 'react-hooks/rules-of-hooks': 'error' }
}];