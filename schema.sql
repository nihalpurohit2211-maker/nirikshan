-- Nirikshan schema (PLAN.md §6.1 exact DDL)
-- Additive-only tables beyond §6.1 are at the end, under "-- ADDITIVE".
-- API field names and table columns are frozen after the first commit: add, never rename/remove.

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,            -- 'src_river', 'plant_n', 'res_hill', 'pump_1',
                                  -- 'J01', 'zone_1', 'B01', 'air_01', 'land_01'
  name TEXT NOT NULL,
  type TEXT NOT NULL,             -- source|treatment_plant|reservoir|pump|junction|
                                  -- zone|building|air_station|land_site
  lat REAL NOT NULL, lon REAL NOT NULL,
  zone_id TEXT,                   -- ward for zones/buildings/stations
  parent_id TEXT                  -- water-tree parent; NULL for sources/plants/air/land
);
CREATE TABLE pipes (
  id TEXT PRIMARY KEY,            -- 'P001'
  from_node TEXT NOT NULL REFERENCES nodes(id),
  to_node TEXT NOT NULL REFERENCES nodes(id),
  length_m REAL, diameter_mm INTEGER, material TEXT, install_year INTEGER
);
CREATE TABLE sensors (
  id TEXT PRIMARY KEY,            -- 'S_zone_3', 'S_air_07'
  node_id TEXT NOT NULL REFERENCES nodes(id),
  kind TEXT NOT NULL              -- 'multi' (water) | 'air'
);
CREATE TABLE readings (
  sensor_id TEXT REFERENCES sensors(id),
  timestamp TEXT NOT NULL,        -- 'YYYY-MM-DD HH:MM:SS'
  ph REAL, turbidity_ntu REAL, tds_mgl REAL, residual_chlorine_mgl REAL
);
CREATE TABLE air_readings (
  station_id TEXT REFERENCES nodes(id),
  timestamp TEXT NOT NULL,
  pm25 REAL, pm10 REAL, no2 REAL, so2 REAL, co REAL, o3 REAL
);
CREATE TABLE lab_tests (
  id TEXT PRIMARY KEY, node_id TEXT, date TEXT,
  total_coliform TEXT, e_coli TEXT, note TEXT
);
CREATE TABLE maintenance_checks (
  id TEXT PRIMARY KEY, node_id TEXT, date TEXT, check_type TEXT, result TEXT
);
CREATE TABLE complaints (
  id TEXT PRIMARY KEY,            -- 'CMP001' from seq table
  timestamp TEXT NOT NULL,
  domain TEXT NOT NULL,           -- 'water' | 'air' | 'land'
  node_id TEXT,                   -- building / air station / land site
  category TEXT, text TEXT, status TEXT DEFAULT 'NEW',
  image_path TEXT,                -- NULL unless uploaded
  extracted_fields TEXT,          -- JSON suggestion (agent or fallback)
  duration_days INTEGER,          -- land only
  area_m2 REAL                    -- land only
);
CREATE TABLE cases (
  id TEXT PRIMARY KEY,            -- 'CASE-2026-001' from seq table
  domain TEXT, node_id TEXT, scope TEXT,   -- MUNICIPAL|BUILDING_SIDE|UNDETERMINED
  status TEXT,                    -- Open|Investigating|Action Taken|Resolved
  severity TEXT,                  -- Low|Medium|High|Emergency
  title TEXT, created_at TEXT, updated_at TEXT,
  evidence_json TEXT
);
CREATE TABLE case_actions (
  id TEXT PRIMARY KEY, case_id TEXT REFERENCES cases(id),
  timestamp TEXT, actor TEXT, role TEXT, action TEXT, note TEXT
);
CREATE TABLE standards (
  id INTEGER PRIMARY KEY, domain TEXT, parameter TEXT,
  acceptable TEXT, permissible TEXT, unit TEXT, citation TEXT
);
CREATE TABLE seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE INDEX idx_readings_ts ON readings(sensor_id, timestamp);
CREATE INDEX idx_air_readings_ts ON air_readings(station_id, timestamp);
CREATE INDEX idx_sensors_node ON sensors(node_id);
CREATE INDEX idx_complaints_node ON complaints(node_id, domain);
CREATE INDEX idx_cases_node ON cases(node_id);

-- ADDITIVE (new tables only; no §6.1 table was changed).
-- Land metadata the proximity + cross-link features need, kept out of `nodes`
-- so the frozen §6.1 DDL stays byte-identical.
CREATE TABLE land_meta (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id),
  land_type TEXT,                 -- open_waste | soil_erosion | other
  linked_water_node TEXT,         -- erosion -> intake cross-link (S8); NULL otherwise
  note TEXT
);
-- Real-world anchor points used by the transparent proximity score (§10).
CREATE TABLE features (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- school | water_body | main_road | hospital
  name TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL
);
