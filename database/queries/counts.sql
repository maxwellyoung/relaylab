-- Row counts for both related tables.
SELECT (SELECT COUNT(*) FROM experiments) AS experiments,
       (SELECT COUNT(*) FROM experiment_runs) AS runs;
