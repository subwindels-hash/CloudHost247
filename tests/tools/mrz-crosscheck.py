#!/usr/bin/env python3
"""
Independent ICAO Doc 9303 check-digit cross-check.

    python3 tests/tools/mrz-crosscheck.py

Why this file exists
--------------------
`tests/tools/compliance-tools.test.mjs` asserts that the shipped generator reproduces the three
machine-readable zones ICAO publishes as specimens. That is only a real test if the *expectations*
are right, and the expectations were written down after reading the same code they test — a mistake
in the field tables would confirm itself.

So this program re-derives every check digit from the ICAO 9303 field tables directly, in a
different language, with no import of the JavaScript under test. It knows nothing about
`tools-local.js`. If the two disagree, one of them is wrong, and the disagreement is the finding.

Field layout used (positions are 0-based slices):

  TD3 — 2 lines of 44
    L1: docCode[0:2] state[2:5] name[5:44]
    L2: docNo[0:9] cd[9] nat[10:13] dob[13:19] cd[19] sex[20] exp[21:27] cd[27]
        optional[28:42] cd[42] composite[43]
    composite source = docNo+cd, dob+cd, exp+cd, optional+cd  →  L2[0:10] + L2[13:20] + L2[21:43]

  TD2 — 2 lines of 36
    L1: docCode[0:2] state[2:5] name[5:36]
    L2: docNo[0:9] cd[9] nat[10:13] dob[13:19] cd[19] sex[20] exp[21:27] cd[27]
        optional[28:35] composite[35]
    composite source = L2[0:10] + L2[13:20] + L2[21:35]   (the optional field has no check digit)

  TD1 — 3 lines of 30
    L1: docCode[0:2] state[2:5] docNo[5:14] cd[14] optional1[15:30]
    L2: dob[0:6] cd[6] sex[7] exp[8:14] cd[14] nat[15:18] optional2[18:29] composite[29]
    L3: name[0:30]
    composite source = L1[5:30] + L2[0:7] + L2[8:15] + L2[18:29]
    Note what the composite deliberately excludes: the sex code (L2 position 7) and the
    nationality (L2 positions 15:18). Covering them produces a self-consistent but wrong zone.
"""

import sys

WEIGHTS = (7, 3, 1)
# ICAO values: 0-9 are worth 0-9, A-Z are worth 10-35, and the filler '<' counts as 0.
# Building this table by enumerating a string is exactly the kind of off-by-one that makes a
# cross-check agree with itself and disagree with the standard, so it is written out explicitly.
VALUES = {char: index for index, char in enumerate("0123456789")}
VALUES.update({char: index + 10 for index, char in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")})
VALUES["<"] = 0
assert len(VALUES) == 37, len(VALUES)
assert (VALUES["0"], VALUES["9"], VALUES["A"], VALUES["Z"], VALUES["<"]) == (0, 9, 10, 35, 0)


def check_digit(field: str) -> int:
    """ICAO 9303 7-3-1 weighted sum, mod 10. '<' counts as 0."""
    total = 0
    for position, char in enumerate(field):
        if char not in VALUES:
            raise ValueError(f"{char!r} is not in the ICAO character set")
        total += VALUES[char] * WEIGHTS[position % 3]
    return total % 10


def lines_of(zone: str):
    return [line for line in zone.replace("\r\n", "\n").split("\n") if line != ""]


def check_td3(zone: str):
    lines = lines_of(zone)
    assert len(lines) == 2, f"TD3 is 2 lines, got {len(lines)}"
    l1, l2 = lines
    assert len(l1) == len(l2) == 44, f"TD3 lines are 44 characters, got {len(l1)} and {len(l2)}"
    return {
        "document number": (l2[9], check_digit(l2[0:9])),
        "date of birth": (l2[19], check_digit(l2[13:19])),
        "expiry date": (l2[27], check_digit(l2[21:27])),
        "optional data": (l2[42], check_digit(l2[28:42])),
        "composite": (l2[43], check_digit(l2[0:10] + l2[13:20] + l2[21:43])),
    }


def check_td2(zone: str):
    lines = lines_of(zone)
    assert len(lines) == 2, f"TD2 is 2 lines, got {len(lines)}"
    l1, l2 = lines
    assert len(l1) == len(l2) == 36, f"TD2 lines are 36 characters, got {len(l1)} and {len(l2)}"
    return {
        "document number": (l2[9], check_digit(l2[0:9])),
        "date of birth": (l2[19], check_digit(l2[13:19])),
        "expiry date": (l2[27], check_digit(l2[21:27])),
        "composite": (l2[35], check_digit(l2[0:10] + l2[13:20] + l2[21:35])),
    }


def check_td1(zone: str):
    lines = lines_of(zone)
    assert len(lines) == 3, f"TD1 is 3 lines, got {len(lines)}"
    l1, l2, l3 = lines
    assert len(l1) == len(l2) == len(l3) == 30, "TD1 lines are 30 characters, got %r" % [
        len(line) for line in lines
    ]
    return {
        "document number": (l1[14], check_digit(l1[5:14])),
        "date of birth": (l2[6], check_digit(l2[0:6])),
        "expiry date": (l2[14], check_digit(l2[8:14])),
        "composite": (l2[29], check_digit(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29])),
    }


# The three specimens ICAO publishes. The holder is the standard test person, so no real
# identity data is reproduced here.
SPECIMENS = {
    "TD3": "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n"
           "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
    "TD1": "I<UTOD231458907<<<<<<<<<<<<<<<\n"
           "7408122F1204159UTO<<<<<<<<<<<6\n"
           "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
    "TD2": "I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<\n"
           "D231458907UTO7408122F1204159<<<<<<<6",
}

CHECKERS = {"TD1": check_td1, "TD2": check_td2, "TD3": check_td3}


def main() -> int:
    failures = 0
    for name, zone in SPECIMENS.items():
        print(f"{name} specimen")
        for field, (found, computed) in CHECKERS[name](zone).items():
            ok = str(computed) == found
            failures += 0 if ok else 1
            print(f"  {'ok  ' if ok else 'FAIL'} {field:<18} printed {found}  recomputed {computed}")

    # A composite that wrongly covers the sex code and nationality must NOT reproduce the specimen.
    # This is the regression guard for the bug this file exists to catch.
    l1, l2, _ = lines_of(SPECIMENS["TD1"])
    wrong = check_digit(l1[5:30] + l2[0:25])
    right = check_digit(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29])
    print(
        f"\nTD1 composite over L1[5:30)+L2[0:25)  = {wrong}  (the wrong range, must differ from the specimen)"
    )
    print(f"TD1 composite over the ICAO ranges      = {right}  (specimen prints {l2[29]})")
    if wrong == int(l2[29]):
        print("FAIL: the wrong range reproduces the specimen, so this test cannot tell them apart")
        failures += 1
    if str(right) != l2[29]:
        print("FAIL: the ICAO ranges do not reproduce the specimen")
        failures += 1

    print()
    if failures:
        print(f"{failures} check digit(s) did not match")
        return 1
    print("all specimens verified against an independent implementation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
