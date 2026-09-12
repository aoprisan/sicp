; Printer cases: MIT writes strings quoted in value position but displays them verbatim,
; and reports "no useful value" separately from a value. Project's own code, not book text.
"hi"
(list 1 "two" 'three)
(cons "a" "b")
(write "a\"b")
(newline)
(display "a\"b")
(newline)
(write (list "x" (list "y")))
(newline)
(display (list "x" (list "y")))
(newline)
(string-append "x" "y")
(number->string 42)
(symbol->string 'abc)
(if #f #f)
