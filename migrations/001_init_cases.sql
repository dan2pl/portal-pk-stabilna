CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY,
  client TEXT NOT NULL,
  loan_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'nowa',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO cases (client, loan_amount, status)
VALUES ('Jan Jankowski', 25000, 'nowa'),
       ('Anna Nowak',    12000, 'analiza')
ON CONFLICT DO NOTHING;
