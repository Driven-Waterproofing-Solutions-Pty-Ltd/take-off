-- Per-page legend persistence. The canvas already tracked legend position +
-- scale + visibility in projectData[pageIndex].legend, but on cloud reload
-- it reverted to defaults because the pages table had no slot for it.

ALTER TABLE pages ADD COLUMN legend_json TEXT;
