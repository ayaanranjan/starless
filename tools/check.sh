#!/bin/sh
# Syntax-check every JS module with macOS's built-in JavaScriptCore (no node needed).
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
cd "$(dirname "$0")/.." || exit 1
fail=0
for f in $(find src -name '*.js' | sort); do
  out=$($JSC -e "try{checkModuleSyntax(readFile('$f'))}catch(e){print('ERR '+e)}" 2>&1)
  if [ -n "$out" ]; then echo "$f: $out"; fail=1; fi
done
[ $fail -eq 0 ] && echo "all modules parse OK"
exit $fail
