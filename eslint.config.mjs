import ts from 'typescript-eslint';
export default [{ignores:['**/dist/**','**/.next/**','**/generated/**','**/next-env.d.ts']}, ...ts.configs.recommended, {rules:{'@typescript-eslint/no-explicit-any':'error'}}];
