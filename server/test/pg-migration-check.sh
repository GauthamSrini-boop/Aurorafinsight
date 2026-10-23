#!/usr/bin/env bash
# Applies the PostgreSQL migration to a throwaway local server and checks the
# key constraints/triggers. Needs PostgreSQL server binaries; does not use pg (npm).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-$(dirname "$(find /usr/lib/postgresql /opt -name initdb 2>/dev/null | head -1)")}"
DATA="$(mktemp -d)"; PORT="${PGPORT:-54331}"
if [ "$(id -u)" = 0 ]; then chown postgres "$DATA"; RUN="runuser -u postgres --"; else RUN=""; fi
cleanup() { $RUN "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
$RUN "$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses='' -c unix_socket_directories=$DATA" -w start >/dev/null
P="$PGBIN/psql -h $DATA -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -d postgres"
$RUN $P -f "$HERE/../src/db/migrations/postgres/001_init.sql"
$RUN $P -f "$HERE/../src/db/migrations/postgres/002_extended_features.sql"
$RUN $P <<'SQL'
insert into users (id,email,name,password_hash,created_at,updated_at) values ('u1','a@x.com','A','h','t','t'),('u2','b@x.com','B','h','t','t');
insert into categories (id,user_id,name,kind,created_at) values ('c1','u1','Food','expense','t'),('c2','u2','Food','expense','t');
insert into transactions (id,user_id,kind,title,amount_minor,category_id,txn_date,created_at,updated_at) values ('t1','u1','expense','x',100,'c1','2026-10-01','t','t');
do $$ begin
  begin insert into transactions (id,user_id,kind,title,amount_minor,category_id,txn_date,created_at,updated_at) values ('t2','u1','expense','x',100,'c2','2026-10-01','t','t'); raise exception 'cross-user category accepted'; exception when foreign_key_violation then null; end;
  begin insert into transactions (id,user_id,kind,title,amount_minor,category_id,txn_date,created_at,updated_at) values ('t3','u1','expense','x',0,'c1','2026-10-01','t','t'); raise exception 'zero amount accepted'; exception when check_violation then null; end;
  begin insert into transactions (id,user_id,kind,title,amount_minor,category_id,txn_date,created_at,updated_at) values ('t4','u1','expense','x',5,'c1','10-01-2026','t','t'); raise exception 'bad date accepted'; exception when check_violation then null; end;
  insert into goals (id,user_id,name,target_minor,created_at,updated_at) values ('g1','u1','G',1000,'t','t');
  insert into goal_contributions (id,user_id,goal_id,amount_minor,contributed_on,created_at) values ('k1','u1','g1',1000,'2026-10-01','t');
  begin insert into goal_contributions (id,user_id,goal_id,amount_minor,contributed_on,created_at) values ('k2','u1','g1',1,'2026-10-01','t'); raise exception 'overfill accepted'; exception when check_violation then null; end;
  begin update goals set target_minor = 500 where id='g1'; raise exception 'target lowered below saved'; exception when check_violation then null; end;
  begin insert into goal_contributions (id,user_id,goal_id,amount_minor,contributed_on,created_at) values ('k3','u2','g1',1,'2026-10-01','t'); raise exception 'cross-user goal accepted'; exception when foreign_key_violation or check_violation then null; end;
  -- 002: withdrawals reduce the saved amount and can never exceed it; deposits respect the target on a net basis
  insert into goal_contributions (id,user_id,goal_id,amount_minor,contributed_on,kind,created_at) values ('k5','u1','g1',400,'2026-10-02','withdrawal','t');
  insert into goal_contributions (id,user_id,goal_id,amount_minor,contributed_on,created_at) values ('k6','u1','g1',400,'2026-10-03','t');
  begin insert into goal_contributions (id,user_id,goal_id,amount_minor,contributed_on,kind,created_at) values ('k7','u1','g1',1001,'2026-10-04','withdrawal','t'); raise exception 'over-withdrawal accepted'; exception when check_violation then null; end;
  begin insert into goal_contributions (id,user_id,goal_id,amount_minor,contributed_on,kind,created_at) values ('k8','u1','g1',5,'2026-10-04','refund','t'); raise exception 'bad kind accepted'; exception when check_violation then null; end;
  begin update users set smartsave_target_minor = -1 where id='u1'; raise exception 'negative target accepted'; exception when check_violation then null; end;
  begin update transactions set payment_method = '' where id='t1'; raise exception 'empty payment method accepted'; exception when check_violation then null; end;
  delete from users where id='u1';
  if (select count(*) from transactions) <> 0 then raise exception 'cascade failed'; end if;
end $$;
SQL
echo "PG MIGRATION CHECKS PASSED"
