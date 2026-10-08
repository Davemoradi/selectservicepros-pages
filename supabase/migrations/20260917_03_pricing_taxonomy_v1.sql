-- SSP pricing taxonomy v1
-- Generated from ssp-taxonomy-v1.js. DO NOT execute until live schema audit is reviewed.
-- Band prices: A=$75, B=$35, C=$18. Ambiguous `Other` rows are held for review.

begin;

-- Fail loudly if the existing band_map schema is not the shape expected by create-lead.js.
do $$
begin
  if to_regclass('public.band_map') is null then
    raise exception 'public.band_map is missing; apply the matching foundation migration first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='band_map' and column_name='version')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='band_map' and column_name='category')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='band_map' and column_name='issue_code')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='band_map' and column_name='label')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='band_map' and column_name='band')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='band_map' and column_name='price_cents')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='band_map' and column_name='requires_clarification') then
    raise exception 'public.band_map schema does not match SSP pricing v1 requirements';
  end if;
end $$;

-- v1 has not been exposed to live matching yet. Replacing only this version gives us
-- one canonical set while leaving any future versions untouched. Existing leads keep
-- their immutable pricing snapshots and do not depend on this table afterward.
delete from public.band_map where version = 'v1';

insert into public.band_map
  (version, category, issue_code, label, band, price_cents, requires_clarification)
values
  ('v1', 'HVAC', 'hvac_ac_not_cooling', 'AC not cooling', 'B', 3500, false),
  ('v1', 'HVAC', 'hvac_ac_warm_air', 'AC blowing warm air', 'B', 3500, false),
  ('v1', 'HVAC', 'hvac_ac_noise', 'AC making noise', 'B', 3500, false),
  ('v1', 'HVAC', 'hvac_ac_water_leak', 'AC leaking water', 'B', 3500, false),
  ('v1', 'HVAC', 'hvac_no_heat_furnace', 'No heat / furnace issue', 'B', 3500, false),
  ('v1', 'HVAC', 'hvac_heat_pump_not_working', 'Heat pump not working', 'B', 3500, false),
  ('v1', 'HVAC', 'hvac_ac_replacement', 'AC replacement / new system', 'A', 7500, false),
  ('v1', 'HVAC', 'hvac_furnace_replacement', 'Furnace replacement', 'A', 7500, false),
  ('v1', 'HVAC', 'hvac_duct_cleaning', 'Duct cleaning', 'C', 1800, false),
  ('v1', 'HVAC', 'hvac_duct_repair', 'Duct repair', 'B', 3500, false),
  ('v1', 'HVAC', 'hvac_thermostat_install_replace', 'Thermostat install / replace', 'C', 1800, false),
  ('v1', 'HVAC', 'hvac_mini_split_install', 'Mini split install', 'A', 7500, false),
  ('v1', 'HVAC', 'hvac_maintenance_tuneup', 'Maintenance / tune-up', 'C', 1800, false),
  ('v1', 'HVAC', 'hvac_other', 'Other', null, null, true),
  ('v1', 'Plumbing', 'plumb_leaky_faucet_pipe', 'Leaky faucet or pipe', 'C', 1800, false),
  ('v1', 'Plumbing', 'plumb_clogged_drain', 'Clogged drain / slow drain', 'B', 3500, false),
  ('v1', 'Plumbing', 'plumb_water_heater_repair', 'Water heater not working', 'B', 3500, false),
  ('v1', 'Plumbing', 'plumb_water_heater_replacement', 'Water heater replacement', 'A', 7500, false),
  ('v1', 'Plumbing', 'plumb_tankless_install', 'Tankless water heater install', 'A', 7500, false),
  ('v1', 'Plumbing', 'plumb_toilet_running_leaking', 'Toilet running / leaking', 'C', 1800, false),
  ('v1', 'Plumbing', 'plumb_garbage_disposal', 'Garbage disposal issue', 'C', 1800, false),
  ('v1', 'Plumbing', 'plumb_sewer_backup', 'Sewer line backup', 'B', 3500, false),
  ('v1', 'Plumbing', 'plumb_sump_pump', 'Sump pump issue', 'B', 3500, false),
  ('v1', 'Plumbing', 'plumb_gas_line_repair', 'Gas line repair', 'B', 3500, false),
  ('v1', 'Plumbing', 'plumb_water_pressure', 'Water pressure issue', 'B', 3500, false),
  ('v1', 'Plumbing', 'plumb_pipe_repair', 'Pipe repair', 'C', 1800, false),
  ('v1', 'Plumbing', 'plumb_repipe', 'Whole-home repiping', 'A', 7500, false),
  ('v1', 'Plumbing', 'plumb_other', 'Other', null, null, true),
  ('v1', 'Electrical', 'elec_outlet_switch', 'Outlet or switch not working', 'C', 1800, false),
  ('v1', 'Electrical', 'elec_light_fixture_install', 'Light fixture install', 'C', 1800, false),
  ('v1', 'Electrical', 'elec_recessed_lighting_install', 'Recessed lighting install', 'B', 3500, false),
  ('v1', 'Electrical', 'elec_ceiling_fan_install', 'Ceiling fan install', 'C', 1800, false),
  ('v1', 'Electrical', 'elec_panel_breaker_upgrade', 'Panel / breaker upgrade', 'A', 7500, false),
  ('v1', 'Electrical', 'elec_wiring_repair', 'Wiring repair', 'C', 1800, false),
  ('v1', 'Electrical', 'elec_rewire_upgrade', 'Wiring upgrade / rewiring', 'A', 7500, false),
  ('v1', 'Electrical', 'elec_generator_install', 'Generator install', 'A', 7500, false),
  ('v1', 'Electrical', 'elec_ev_charger_install', 'EV charger install', 'A', 7500, false),
  ('v1', 'Electrical', 'elec_smoke_co_install', 'Smoke / CO detector install', 'C', 1800, false),
  ('v1', 'Electrical', 'elec_landscape_lighting', 'Landscape / outdoor lighting', 'B', 3500, false),
  ('v1', 'Electrical', 'elec_flickering_dimming', 'Flickering or dimming lights', 'B', 3500, false),
  ('v1', 'Electrical', 'elec_other', 'Other', null, null, true),
  ('v1', 'Roofing', 'roof_leak_repair', 'Roof leak repair', 'B', 3500, false),
  ('v1', 'Roofing', 'roof_shingle_repair', 'Shingle repair', 'B', 3500, false),
  ('v1', 'Roofing', 'roof_shingle_replacement', 'Shingle replacement', 'A', 7500, false),
  ('v1', 'Roofing', 'roof_full_replacement', 'Full roof replacement', 'A', 7500, false),
  ('v1', 'Roofing', 'roof_flat_repair', 'Flat roof repair', 'B', 3500, false),
  ('v1', 'Roofing', 'roof_storm_hail', 'Storm / hail damage', 'A', 7500, false),
  ('v1', 'Roofing', 'roof_gutter_repair', 'Gutter repair', 'C', 1800, false),
  ('v1', 'Roofing', 'roof_gutter_install', 'Gutter installation', 'B', 3500, false),
  ('v1', 'Roofing', 'roof_gutter_cleaning', 'Gutter cleaning', 'C', 1800, false),
  ('v1', 'Roofing', 'roof_inspection', 'Roof inspection', 'C', 1800, false),
  ('v1', 'Roofing', 'roof_skylight_install_repair', 'Skylight install or repair', 'B', 3500, false),
  ('v1', 'Roofing', 'roof_other', 'Other', null, null, true),
  ('v1', 'Handyman', 'handy_drywall_repair', 'Drywall repair / patching', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_tv_mounting', 'TV mounting', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_furniture_assembly', 'Furniture assembly', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_shelf_curtain_install', 'Shelf / curtain rod install', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_door_repair', 'Door repair or adjustment', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_fence_gate_repair', 'Fence / gate repair', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_pressure_washing', 'Pressure washing', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_caulking_weatherstrip', 'Caulking / weatherstripping', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_deck_repair', 'Deck repair', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_tile_grout_repair', 'Tile / grout repair', 'C', 1800, false),
  ('v1', 'Handyman', 'handy_other', 'Other', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_refrigerator_not_cooling', 'Refrigerator not cooling', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_washer_not_spinning_draining', 'Washer not spinning / draining', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_dryer_not_heating', 'Dryer not heating', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_dishwasher_not_cleaning', 'Dishwasher not cleaning', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_oven_stove_not_heating', 'Oven / stove not heating', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_ice_maker_not_working', 'Ice maker not working', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_garbage_disposal_jammed', 'Garbage disposal jammed', 'C', 1800, false),
  ('v1', 'Appliance Repair', 'appl_other', 'Other', 'C', 1800, false),
  ('v1', 'Construction', 'remod_kitchen', 'Kitchen remodel', 'A', 7500, false),
  ('v1', 'Construction', 'remod_bathroom', 'Bathroom remodel', 'A', 7500, false),
  ('v1', 'Construction', 'remod_flooring_install', 'Flooring installation', 'A', 7500, false),
  ('v1', 'Construction', 'remod_tile_install', 'Tile installation', 'A', 7500, false),
  ('v1', 'Construction', 'remod_room_addition', 'Room addition', 'A', 7500, false),
  ('v1', 'Construction', 'remod_basement_finish', 'Basement finishing', 'A', 7500, false),
  ('v1', 'Construction', 'remod_deck_patio_build', 'Deck / patio build', 'A', 7500, false),
  ('v1', 'Construction', 'remod_cabinet_install_reface', 'Cabinet install / reface', 'A', 7500, false),
  ('v1', 'Construction', 'remod_countertop_install', 'Countertop installation', 'A', 7500, false),
  ('v1', 'Construction', 'remod_other', 'Other', 'A', 7500, false),
  ('v1', 'Pool & Spa', 'pool_cleaning_maintenance', 'Pool cleaning / maintenance', 'C', 1800, false),
  ('v1', 'Pool & Spa', 'pool_pump_filter_repair', 'Pool pump or filter repair', 'B', 3500, false),
  ('v1', 'Pool & Spa', 'pool_leak_detection', 'Pool leak detection', 'B', 3500, false),
  ('v1', 'Pool & Spa', 'pool_heater_repair', 'Pool heater repair', 'B', 3500, false),
  ('v1', 'Pool & Spa', 'pool_resurfacing', 'Pool resurfacing', 'A', 7500, false),
  ('v1', 'Pool & Spa', 'pool_spa_hot_tub_service', 'Spa / hot tub service', 'B', 3500, false),
  ('v1', 'Pool & Spa', 'pool_other', 'Other', null, null, true),
  ('v1', 'Windows & Doors', 'wd_window_replacement', 'Window replacement', 'A', 7500, false),
  ('v1', 'Windows & Doors', 'wd_window_repair', 'Window repair', 'B', 3500, false),
  ('v1', 'Windows & Doors', 'wd_interior_door_install', 'Interior door installation', 'C', 1800, false),
  ('v1', 'Windows & Doors', 'wd_exterior_door_install', 'Exterior / entry door installation', 'B', 3500, false),
  ('v1', 'Windows & Doors', 'wd_door_repair', 'Door repair', 'C', 1800, false),
  ('v1', 'Windows & Doors', 'wd_sliding_door_repair', 'Sliding door repair', 'C', 1800, false),
  ('v1', 'Windows & Doors', 'wd_storm_door_install', 'Storm door install', 'C', 1800, false),
  ('v1', 'Windows & Doors', 'wd_screen_repair_replace', 'Screen repair / replace', 'C', 1800, false),
  ('v1', 'Windows & Doors', 'wd_other', 'Other', null, null, true),
  ('v1', 'Painting', 'paint_interior_full_room', 'Interior painting (full room)', 'B', 3500, false),
  ('v1', 'Painting', 'paint_touchup_accent', 'Interior touch-up / accent wall', 'C', 1800, false),
  ('v1', 'Painting', 'paint_exterior', 'Exterior painting', 'B', 3500, false),
  ('v1', 'Painting', 'paint_cabinet_refinish', 'Cabinet painting / refinishing', 'B', 3500, false),
  ('v1', 'Painting', 'paint_deck_fence_stain', 'Deck / fence staining', 'B', 3500, false),
  ('v1', 'Painting', 'paint_wallpaper_removal', 'Wallpaper removal', 'C', 1800, false),
  ('v1', 'Painting', 'paint_popcorn_removal', 'Popcorn ceiling removal', 'B', 3500, false),
  ('v1', 'Painting', 'paint_other', 'Other', null, null, true);

-- Safety assertions: exact row count, unique labels per category, exact prices.
do $$
declare
  v_count integer;
  v_held integer;
begin
  select count(*), count(*) filter (where requires_clarification)
    into v_count, v_held
    from public.band_map where version='v1';
  if v_count <> 106 then raise exception 'pricing v1 expected 106 rows, found %', v_count; end if;
  if v_held <> 7 then raise exception 'pricing v1 expected 7 held-for-review rows, found %', v_held; end if;
  if exists (
    select 1 from public.band_map where version='v1'
     and ((band='A' and price_cents<>7500) or (band='B' and price_cents<>3500) or (band='C' and price_cents<>1800))
  ) then raise exception 'pricing v1 contains an invalid band/price pair'; end if;
  if exists (
    select category, label from public.band_map where version='v1' group by category, label having count(*) > 1
  ) then raise exception 'pricing v1 contains duplicate category/label rows'; end if;
end $$;

commit;