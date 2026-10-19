-- 병합해제 시 target 방송 원복을 위해 병합 당시 target의 broadcast_id 저장
ALTER TABLE merge_history ADD COLUMN IF NOT EXISTS target_broadcast_id integer;
