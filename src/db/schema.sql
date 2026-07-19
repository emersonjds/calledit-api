create table if not exists feed_events (
  id          bigserial primary key,
  fixture_id  text not null,
  seq         int  not null,
  kind        text not null,
  ts          timestamptz not null,
  payload     jsonb not null,
  unique (fixture_id, kind, seq)
);
create index if not exists feed_events_fixture_seq on feed_events (fixture_id, seq);

create table if not exists predictions (
  id            uuid primary key,
  address       text not null,
  match_id      text not null,
  market        text not null,
  provable      boolean not null,
  stake_sol     numeric not null,
  multiplier    numeric not null,
  potential_sol numeric not null,
  at_clock_min  int not null,
  window_min    int not null,
  status        text not null default 'resolving',
  tx_hash       text,
  stamped_at    bigint,
  seq           int,
  epoch_day     int,
  settlement    jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists predictions_address on predictions (address);
create index if not exists predictions_match on predictions (match_id);
create unique index if not exists predictions_tx_hash_unique on predictions (tx_hash);
