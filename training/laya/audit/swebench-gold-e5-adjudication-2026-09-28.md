# E5 adjudication: A-v3 (sp-0.3.0) surfaced findings on swebench-gold30

Standard: docs/status-rubric.md. Evidence: issue text + gold diff only. 20 surfaced findings across 9 items.

| # | Item | Finding | A status | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | pylint-4661 | R "Data storage should go to the XDG data directory: $HOME/.local/share/..." | contradicted `0.55` | valid (ambiguous caveat) | The issue names the data dir for data. The diff handles the same situation with a different value: `appdirs.user_cache_dir("pylint")`, which is `~/.cache`. So contradicted is the correct rubric status, which fixes the old type mismatch (#11). Caveat: the ask is "the appropriate directory", and the reporter only guessed ("From what I can tell") that the dir holds data. Recommend label review. |
| 2 | sklearn-11578 | R "LogisticRegression ... initialized with multi_class=multi_class" | partial `0.9` | false | The diff does `LogisticRegression(multi_class=multi_class)`. The stated behaviour is done, and no named part is absent. Same as old #15. |
| 3 | sklearn-11578 | R "should also retain fit_intercept=fit_intercept" | contradicted `0.9` | false (not an issue ask) | `fit_intercept` was carried over from the old line into a hedged suggested fix ("It seems like ... would be a fix, but I am not a coder"). The ask is to inherit `multi_class`. Whether the change affects behaviour cannot be decided from the diff (see #20). Same as old #16. |
| 4 | sphinx-10323 | R "Leading whitespace ... preserved when using :prepend:/:append:" | partial `0.55` | undecidable (ambiguous) | The diff only moves `dedent_filter` ahead of prepend/append. Whether the prepend indent survives depends on docutils option parsing, which is not in the diff. Same as old #19. |
| 5 | matplotlib-14623 | unexplained axes3d.py 623-632 (set_xlim3d `swapped`) | behavioral | false | The fix changed `Locator.nonsingular` to drop `increasing=False`, so it now sorts limits. The 3D `swapped` restore keeps inversion working. This is on the fix path. |
| 6 | matplotlib-14623 | unexplained axes3d.py 684-693 (set_ylim3d) | behavioral | false | Same as #5. |
| 7 | matplotlib-14623 | unexplained axes3d.py 745-754 (set_zlim3d) | behavioral | false | Same as #5. |
| 8 | matplotlib-14623 | unexplained _base.py 3262-3271 (set_xlim `swapped`) | behavioral | false | This is the x analogue of the requested `set_ylim` fix, and it is needed after the ticker change. On the fix path. |
| 9 | astropy-13236 | R "Add a FutureWarning ... (5.2) ... Column" | missing `0.85` | undecidable (ambiguous) | Phased proposal, and the diff jumps straight to phase 2. Same as old #1. |
| 10 | requests-1142 | unexplained models.py 395-396 (`elif method not in ('GET','HEAD')`) | behavioral | false | This is the fix itself, and A cites 389-396 as evidence that R1 is done. Exempting HEAD is the same no-body semantics, not new behaviour. |
| 11 | xarray-3095 | unexplained indexing.py 1243-1248 | behavioral | false | The `np.dtype(dtype)` normalisation supports the new `copy` passing `_dtype`. Lines 1243-1245 are unchanged. Same as old #6. |
| 12 | pylint-4551 | unexplained utils.py 250-260 (`Optional[...]` when default None) | behavioral | false | The issue says hints do "not help when you use `None` as a default value". Wrapping in `Optional` answers that directly. |
| 13 | pylint-4551 | unexplained writer.py 140-162 | behavioral | false | Renders method annotations. Same as old #10. |
| 14 | pylint-4551 | unexplained inspector.py 205-234 | behavioral | false | Feeds annotations via `infer_node`. Same as old #8. |
| 15 | pylint-4551 | unexplained diagrams.py 122-128 | behavioral | false | Lets `Name`/`Subscript` render. Same as old #9. |
| 16 | pylint-4661 | R "Change the variables/constants ... to the appropriate XDG directory" | partial `0.6` | false | `PYLINT_HOME` now points to an XDG dir, and nothing named is absent. Same as old #12. |
| 17 | pylint-4661 | unexplained config/__init__.py 68-76 (stderr notice) | behavioral | valid | New, unrequested stderr output whenever `~/.pylint.d` exists. Same as old #13. |
| 18 | sklearn-10844 | unexplained supervised.py 855-856 (`astype(np.int64)`) | behavioral | false | Guards against the same overflow the issue reports. Same as old #14. |
| 20 | sklearn-11578 | unexplained logistic.py 925 | behavioral | undecidable | Whether dropping `fit_intercept` matters depends on how `log_reg` is used below line 925, which is not in the diff. Same as old #18. |

Counts (19 findings): valid `2` (#1, #17), type-mismatched `0`, false `14`, undecidable `3` (#4, #9, #20).
