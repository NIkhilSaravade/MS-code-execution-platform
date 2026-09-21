# Common Anti-Patterns and CVE-Adjacent Issues

Curated per-language reference material for the code-review agent's
`fetch_similar_past_reviews` tool and hybrid-search retrieval (Phase 2).
Each heading is one retrievable unit: a real, well-known issue class, why
it matters, and a minimal example. This replaces the 5 hardcoded one-line
facts `seed_knowledge.py` previously seeded as the entire "knowledge base."

## Python: Mutable Default Argument

A mutable object (list, dict, set) used as a default argument value is
created once, at function-definition time, and shared across every call
that doesn't pass its own value - not recreated per call as many people
expect from other languages' default-argument semantics. This causes state
to silently leak between unrelated calls.

```python
def add_item(item, bucket=[]):
    bucket.append(item)
    return bucket
```

Fix: default to `None` and create the mutable object inside the function
body when the default is used.

## Python: Catching Bare `except:`

A bare `except:` (or `except Exception:` used indiscriminately) swallows
`KeyboardInterrupt`, `SystemExit`, and genuine bugs alike, making failures
silent instead of surfaced. This is especially dangerous in a judged
submission context, where a bug that should produce a wrong-answer verdict
instead produces a misleadingly "successful" run.

```python
def parse(raw):
    try:
        return int(raw)
    except:
        return 0
```

Fix: catch the specific exception type(s) expected, and let anything else
propagate.

## Python: Use of `eval`/`exec` on Untrusted Input

`eval`/`exec` on any string that isn't fully controlled by the program
itself is arbitrary code execution. This is the exact class of issue
`run_security_scan` (bandit rule B307) is wired to catch in this service's
own tool loop.

```python
def compute(expr):
    return eval(expr)
```

Fix: use `ast.literal_eval` for literal-only input, or a proper expression
parser/interpreter scoped to the actual grammar needed.

## Java: String Concatenation Inside a Loop

`String` is immutable in Java; `s = s + x` inside a loop allocates a new
string object on every iteration, making an O(n)-looking loop actually
O(n^2) in practice for large n - a common cause of TLE verdicts that look
like a correct algorithm on small sample inputs.

```java
String result = "";
for (int i = 0; i < n; i++) {
    result += String.valueOf(arr[i]);
}
```

Fix: use `StringBuilder` and call `.append()`, converting to a `String`
once at the end.

## Java: Autoboxing Inside a Hot Loop

Using `Integer`/`Long` (boxed types) instead of `int`/`long` as loop
accumulators or in tight numeric loops adds allocation and unboxing
overhead per operation. For a judge with a tight time limit, this can be
the difference between AC and TLE on a solution that is asymptotically
correct.

## C: Buffer Overflow via `strcpy`/`sprintf`

`strcpy`/`sprintf` (without a length-bounded variant) write until they hit
a NUL terminator in the source, with no bound on the destination buffer's
size. If the source is longer than the destination, this overwrites
adjacent memory - a classic, still-common memory-safety bug (the same
class behind a large fraction of historical CVEs in C codebases).

```c
char buf[16];
strcpy(buf, user_input);
```

Fix: use `strncpy`/`snprintf` with an explicit destination size, and always
account for the NUL terminator.

## C: Missing `free` on Every Return Path

When a function has multiple `return` statements after a `malloc`, it's
easy to free memory on the success path but forget an early-return error
path, leaking memory on every call that takes that path.

## C++: Returning a Reference/Pointer to a Local Variable

Returning `&local` or a reference to a stack-allocated local from a
function returns a dangling reference the moment the function returns -
the caller reads freed stack memory, which may appear to "work" on small
inputs and fail unpredictably on larger ones.

## JavaScript/TypeScript: `==` Instead of `===`

`==` performs type coercion before comparing, producing surprising results
(`"" == 0` is `true`, `null == undefined` is `true`, `[] == false` is
`true`). In a submitted solution this is a common source of subtle
wrong-answer verdicts on edge-case inputs (empty arrays/strings, `0` vs
falsy values) that pass on the visible sample cases.

## JavaScript: Off-by-One in Array Bounds from `<=` vs `<`

Looping `for (let i = 0; i <= arr.length; i++)` reads `arr[arr.length]`,
which is `undefined` in JavaScript rather than a hard crash (unlike a
segfault in C) - so this bug frequently manifests as a quiet wrong answer
(e.g. `undefined` leaking into a sum or comparison) instead of a visible
runtime error, making it harder to spot from the verdict alone.

## Go: Ignoring an Error Return Value

Go functions that can fail conventionally return `(result, error)`; code
that ignores the second value (`result, _ := doThing()`) silently proceeds
with a zero-value/partial result on failure instead of handling it,
producing incorrect output with no indication anything went wrong.

## General: Off-by-One in Binary Search Bounds

Binary search implementations commonly get the loop condition
(`low <= high` vs `low < high`) or the bound update
(`high = mid` vs `high = mid - 1`) wrong in a way that either infinite-loops
on a two-element range or excludes a valid boundary element - one of the
most common single-line bugs across every language in this class of
problem.

## General: Off-by-One in Sliding Window Size

A sliding-window solution that computes window size as `right - left`
instead of `right - left + 1` (or vice versa, depending on whether `right`
is inclusive) is a frequent source of a solution that is off by exactly one
on window-boundary test cases while passing every other case.
