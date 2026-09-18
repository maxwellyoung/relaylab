-- How the classified outcomes are distributed. Reads the outcome index.
SELECT outcome, COUNT(*) AS runs
FROM experiment_runs
GROUP BY outcome
ORDER BY runs DESC, outcome;
