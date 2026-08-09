// Generates each language's empty-body starter stub from a problem's
// function signature - used by SolvePage so a newly admin-created problem
// gets working starter code without the admin having to hand-write all 7
// (see AddProblemPage, which only collects the signature itself). Mirrors
// the hand-written stubs the old mock data/problems.ts used to ship, and
// the exact per-language type-mapping conventions problem-service's own
// harness generators use server-side (see problem-service's harness
// package) - so what shows up in the editor matches what actually gets
// judged.

import type { Language } from '../data/problems';
import type { FunctionParam, FunctionSignature } from '../api/problems';

type SupportedType = FunctionParam['type'];

// Per-language type name for each of the 5 supported types. JS has no
// static types at all (hence 'unknown' -> handled separately via JSDoc);
// every other language maps straight across.
const TYPE_NAMES: Record<Exclude<Language, 'javascript'>, Record<SupportedType, string>> = {
  typescript: { int: 'number', 'int[]': 'number[]', 'int[][]': 'number[][]', string: 'string', bool: 'boolean' },
  python: { int: 'int', 'int[]': 'list[int]', 'int[][]': 'list[list[int]]', string: 'str', bool: 'bool' },
  java: { int: 'int', 'int[]': 'int[]', 'int[][]': 'int[][]', string: 'String', bool: 'boolean' },
  // Array params are taken by reference (matches every existing hand-written
  // C++ stub, e.g. `vector<int>& nums`); array RETURN types are by value
  // (e.g. `vector<int> twoSum(...)`) - handled separately below.
  cpp: { int: 'int', 'int[]': 'vector<int>&', 'int[][]': 'vector<vector<int>>&', string: 'string', bool: 'bool' },
  c: { int: 'int', 'int[]': 'int*', 'int[][]': 'int**', string: 'char*', bool: 'bool' },
  go: { int: 'int', 'int[]': '[]int', 'int[][]': '[][]int', string: 'string', bool: 'bool' },
};

// JS-flavor type strings for JSDoc @param/@return annotations only - JS
// itself has no type syntax in the function signature.
const JSDOC_TYPE_NAMES: Record<SupportedType, string> = {
  int: 'number',
  'int[]': 'number[]',
  'int[][]': 'number[][]',
  string: 'string',
  bool: 'boolean',
};

const NO_SIGNATURE_COMMENT: Record<Language, string> = {
  javascript: '// This problem has no starter signature - write a full program.\n',
  typescript: '// This problem has no starter signature - write a full program.\n',
  python: '# This problem has no starter signature - write a full program.\n',
  java: '// This problem has no starter signature - write a full program.\n',
  cpp: '// This problem has no starter signature - write a full program.\n',
  c: '// This problem has no starter signature - write a full program.\n',
  go: '// This problem has no starter signature - write a full program.\n',
};

export function generateStarterCode(signature: FunctionSignature | null, language: Language): string {
  if (!signature) {
    return NO_SIGNATURE_COMMENT[language];
  }

  switch (language) {
    case 'javascript':
      return javascriptStub(signature);
    case 'typescript':
      return typescriptStub(signature);
    case 'python':
      return pythonStub(signature);
    case 'java':
      return javaStub(signature);
    case 'cpp':
      return cppStub(signature);
    case 'c':
      return cStub(signature);
    case 'go':
      return goStub(signature);
  }
}

function javascriptStub({ functionName, params }: FunctionSignature): string {
  const paramLines = params.map((p) => ` * @param {${JSDOC_TYPE_NAMES[p.type]}} ${p.name}`).join('\n');
  const paramNames = params.map((p) => p.name).join(', ');
  return `/**\n${paramLines}\n */\nfunction ${functionName}(${paramNames}) {\n  \n}\n`;
}

function typescriptStub({ functionName, params, returnType }: FunctionSignature): string {
  const paramList = params.map((p) => `${p.name}: ${TYPE_NAMES.typescript[p.type]}`).join(', ');
  return `function ${functionName}(${paramList}): ${TYPE_NAMES.typescript[returnType]} {\n  \n};\n`;
}

function pythonStub({ functionName, params, returnType }: FunctionSignature): string {
  const paramList = params.map((p) => `${p.name}: ${TYPE_NAMES.python[p.type]}`).join(', ');
  return `class Solution:\n    def ${functionName}(self, ${paramList}) -> ${TYPE_NAMES.python[returnType]}:\n        pass\n`;
}

function javaStub({ functionName, params, returnType }: FunctionSignature): string {
  const paramList = params.map((p) => `${TYPE_NAMES.java[p.type]} ${p.name}`).join(', ');
  return `class Solution {\n    public ${TYPE_NAMES.java[returnType]} ${functionName}(${paramList}) {\n        \n    }\n}\n`;
}

function cppStub({ functionName, params, returnType }: FunctionSignature): string {
  const paramList = params.map((p) => `${TYPE_NAMES.cpp[p.type]} ${p.name}`).join(', ');
  // Return by value, not by reference - see TYPE_NAMES.cpp's comment.
  const cppReturnType = TYPE_NAMES.cpp[returnType].replace(/&$/, '');
  return `class Solution {\npublic:\n    ${cppReturnType} ${functionName}(${paramList}) {\n        \n    }\n};\n`;
}

function goStub({ functionName, params, returnType }: FunctionSignature): string {
  const paramList = params.map((p) => `${p.name} ${TYPE_NAMES.go[p.type]}`).join(', ');
  return `func ${functionName}(${paramList}) ${TYPE_NAMES.go[returnType]} {\n\t\n}\n`;
}

// C follows the real LeetCode-C convention (raw pointers + out-params),
// mirroring problem-service's CHarnessGenerator exactly: every array PARAM
// gets a trailing size param (immediately after it, not batched at the
// end - e.g. `int* nums, int numsSize`); an array RETURN type changes the
// function's return to a pointer and appends out-params at the very end
// (`int* returnSize` for int[], plus `int* returnColumnSizes` for int[][]).
function cStub({ functionName, params, returnType }: FunctionSignature): string {
  const paramParts: string[] = [];
  for (const p of params) {
    paramParts.push(`${TYPE_NAMES.c[p.type]} ${p.name}`);
    if (p.type === 'int[]') {
      paramParts.push(`int ${p.name}Size`);
    } else if (p.type === 'int[][]') {
      paramParts.push(`int ${p.name}Size`, `int* ${p.name}ColSize`);
    }
  }

  let cReturnType = TYPE_NAMES.c[returnType];
  if (returnType === 'int[]') {
    paramParts.push('int* returnSize');
  } else if (returnType === 'int[][]') {
    paramParts.push('int* returnSize', 'int** returnColumnSizes');
  }

  return `${cReturnType} ${functionName}(${paramParts.join(', ')}) {\n    \n}\n`;
}
