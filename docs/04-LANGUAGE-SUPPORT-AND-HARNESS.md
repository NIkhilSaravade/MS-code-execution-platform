# Language Support & the Harness System

## The problem this solves

LeetCode-style judging needs the user to write **only their function**
(`twoSum`, `class Solution:`, etc.), not a full program with stdin parsing
and output formatting. Something has to glue a `main`/entry-point around
whatever the user submits, matching the exact function signature the problem
defines, for **seven different languages** with wildly different type
systems: Java, C++, C, Python, JavaScript, TypeScript, Go.

This is split across two services:
- **`problem-service`** owns per-language **harness generators** — one class
  per language, each implementing `HarnessGenerator`, that turn a language-
  agnostic `FunctionSignature` (name, params, return type) into the
  boilerplate that goes *after* the user's code.
- **`submission-service`** owns `HarnessApplier`, which glues the generated
  harness onto the user's raw code and prepends any language-specific
  **preamble** that has to come *before* it.

## Why some languages need a preamble and others don't

```java
// HarnessApplier.PREAMBLES
"java", "import java.util.*;\n\n"
"cpp",  "#include <bits/stdc++.h>\nusing namespace std;\n\n"
"c",    "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n"
        + "#include <stdbool.h>\n#include <ctype.h>\n\n"
"go",   "package main\n\nimport (\n\t\"encoding/json\"\n\t\"fmt\"\n\t\"io\"\n\t\"os\"\n)\n\n"
```

Java needs common collection imports before any type declaration; C/C++'s
harness-generated types (`vector`, `string`) need to be `#include`d before
the user's own method signatures reference them; Go's compiler enforces
import declarations before *any* other top-level declaration — Go's own
harness generator can't legally emit `package main`/imports itself because
they must precede the user's function, not follow it. Python, JavaScript,
and TypeScript need no preamble — their harness is only ever appended.

Final assembled source = `preamble + userCode + "\n\n" + harness`.

## Per-language approach

| Language | User writes | Harness appends | Notable trick |
|---|---|---|---|
| **Python** | `class Solution:` with the method | An `if __name__ == "__main__":` block that `json.loads(sys.stdin.read())`, calls `Solution().method(...)`, `json.dumps` the result | No type casting needed at all — `json.loads` already produces native Python types matching the platform's type vocabulary |
| **JavaScript** | A plain top-level function | A small stdin-read + JSON-parse + call + `console.log(JSON.stringify(...))` wrapper (`JsFamilyHarness`, shared with TypeScript) | Dynamic typing means no per-param type mapping needed |
| **TypeScript** | A plain top-level function, typed | Same `JsFamilyHarness` wrapper as JavaScript, compiled via `tsc` first | Shares its harness generator with JavaScript since the generated wrapper code is JS either way |
| **Go** | A plain top-level `func` (no `package main`, no imports — the preamble supplies those) | An anonymous struct matching the signature's params (each JSON-tagged), `json.Unmarshal` from stdin, call, `json.Marshal` + `fmt.Println` | Go's `encoding/json` handles both directions natively — no hand-rolled JSON helper needed, unlike C/C++/Java |
| **Java** | A method inside a class matching the expected signature | A `main` that parses stdin JSON, calls the method, prints the result | Needs a hand-written JSON helper (no JSON library in the plain JDK sandbox image) |
| **C++** | A plain function (or class method, LeetCode-style) | A `main` with a hand-written JSON helper appended **before** `main()` | C++ compiles top-to-bottom with no forward resolution across the file, so the helper must physically precede its use |
| **C** | A LeetCode-convention C signature — see below | A hand-written JSON helper + `main`, both appended before `main()` for the same top-to-bottom reason | The most involved generator by far — see next section |

## C is the hard case: no arrays-with-length, no generics

C has no way to express "an array, and also know its length" as a single
type, and no strings-with-length or generics at all. A generic
type→param mapping (as every other language gets) isn't enough — the C
generator has to emit **companion parameters** matching real LeetCode C
convention exactly, so the frontend's starter code for C problems matches
what a LeetCode user would actually expect:

- an `int[]` **parameter** becomes `(int* name, int nameSize)`
- an `int[][]` **parameter** becomes `(int** name, int nameSize, int* nameColSize)`
- an `int[]` **return** adds a trailing `(..., int* returnSize)` out-param,
  and the function is expected to return a `malloc`'d `int*`
- an `int[][]` **return** adds trailing
  `(..., int* returnSize, int** returnColumnSizes)` out-params

This mirrors LeetCode's actual C templates (e.g. Two Sum's real signature is
`int* twoSum(int* nums, int numsSize, int target, int* returnSize)`) rather
than inventing a friendlier custom convention — because the point is
matching what a LeetCode-experienced user already expects to type.

Since the plain `gcc` sandbox image has no JSON library, C (like C++ and
Java) ships a small, hand-written, deliberately **fixed** JSON reader/writer
(`resources/harness-templates/JsonHelper.c.txt`) restricted to exactly the
platform's supported type vocabulary (`int`, `int[]`, `int[][]`, `string`,
`bool`) — not a general-purpose JSON library, just enough to round-trip
what this platform's problems ever need.

## The type vocabulary

A shared `TypeVocabulary` class enforces which types every harness generator
is allowed to accept (`int`, `int[]`, `int[][]`, `string`, `bool` — see
`GoHarnessGenerator`'s `GO_TYPE` map for the canonical list), so a problem
author can't define a signature using a type no generator knows how to
serialize/deserialize across all seven languages at once.

## Where this connects to the sandbox

Once `HarnessApplier` produces the final assembled source, it's what actually
gets uploaded to S3/MinIO and handed to `worker-service-go` — see
`03-SANDBOX-EXECUTION-ENGINE.md` for what happens to it from there
(`desc.SourceFilename`, `desc.CompileCmd`, `desc.ExecCmd`).
