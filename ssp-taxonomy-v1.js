// SSP canonical homeowner issue taxonomy + lead pricing v1.
// Generated/maintained as a single source used by intake and migration verification.
(function (root, factory) {
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.SSP_TAXONOMY_V1 = data;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
  "version": "v1",
  "prices_cents": {
    "A": 7500,
    "B": 3500,
    "C": 1800
  },
  "issues": {
    "HVAC": [
      {
        "code": "hvac_ac_not_cooling",
        "label": "AC not cooling",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "hvac_ac_warm_air",
        "label": "AC blowing warm air",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "hvac_ac_noise",
        "label": "AC making noise",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "hvac_ac_water_leak",
        "label": "AC leaking water",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "hvac_no_heat_furnace",
        "label": "No heat / furnace issue",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "hvac_heat_pump_not_working",
        "label": "Heat pump not working",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "hvac_ac_replacement",
        "label": "AC replacement / new system",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "hvac_furnace_replacement",
        "label": "Furnace replacement",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "hvac_duct_cleaning",
        "label": "Duct cleaning",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "hvac_duct_repair",
        "label": "Duct repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "hvac_thermostat_install_replace",
        "label": "Thermostat install / replace",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "hvac_mini_split_install",
        "label": "Mini split install",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "hvac_maintenance_tuneup",
        "label": "Maintenance / tune-up",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "hvac_other",
        "label": "Other",
        "band": null,
        "price_cents": null,
        "requires_clarification": true
      }
    ],
    "Plumbing": [
      {
        "code": "plumb_leaky_faucet_pipe",
        "label": "Leaky faucet or pipe",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "plumb_clogged_drain",
        "label": "Clogged drain / slow drain",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "plumb_water_heater_repair",
        "label": "Water heater not working",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "plumb_water_heater_replacement",
        "label": "Water heater replacement",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "plumb_tankless_install",
        "label": "Tankless water heater install",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "plumb_toilet_running_leaking",
        "label": "Toilet running / leaking",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "plumb_garbage_disposal",
        "label": "Garbage disposal issue",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "plumb_sewer_backup",
        "label": "Sewer line backup",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "plumb_sump_pump",
        "label": "Sump pump issue",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "plumb_gas_line_repair",
        "label": "Gas line repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "plumb_water_pressure",
        "label": "Water pressure issue",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "plumb_pipe_repair",
        "label": "Pipe repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "plumb_repipe",
        "label": "Whole-home repiping",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "plumb_other",
        "label": "Other",
        "band": null,
        "price_cents": null,
        "requires_clarification": true
      }
    ],
    "Electrical": [
      {
        "code": "elec_outlet_switch",
        "label": "Outlet or switch not working",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "elec_light_fixture_install",
        "label": "Light fixture install",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "elec_recessed_lighting_install",
        "label": "Recessed lighting install",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "elec_ceiling_fan_install",
        "label": "Ceiling fan install",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "elec_panel_breaker_upgrade",
        "label": "Panel / breaker upgrade",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "elec_wiring_repair",
        "label": "Wiring repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "elec_rewire_upgrade",
        "label": "Wiring upgrade / rewiring",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "elec_generator_install",
        "label": "Generator install",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "elec_ev_charger_install",
        "label": "EV charger install",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "elec_smoke_co_install",
        "label": "Smoke / CO detector install",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "elec_landscape_lighting",
        "label": "Landscape / outdoor lighting",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "elec_flickering_dimming",
        "label": "Flickering or dimming lights",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "elec_other",
        "label": "Other",
        "band": null,
        "price_cents": null,
        "requires_clarification": true
      }
    ],
    "Roofing": [
      {
        "code": "roof_leak_repair",
        "label": "Roof leak repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "roof_shingle_repair",
        "label": "Shingle repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "roof_shingle_replacement",
        "label": "Shingle replacement",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "roof_full_replacement",
        "label": "Full roof replacement",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "roof_flat_repair",
        "label": "Flat roof repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "roof_storm_hail",
        "label": "Storm / hail damage",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "roof_gutter_repair",
        "label": "Gutter repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "roof_gutter_install",
        "label": "Gutter installation",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "roof_gutter_cleaning",
        "label": "Gutter cleaning",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "roof_inspection",
        "label": "Roof inspection",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "roof_skylight_install_repair",
        "label": "Skylight install or repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "roof_other",
        "label": "Other",
        "band": null,
        "price_cents": null,
        "requires_clarification": true
      }
    ],
    "Handyman": [
      {
        "code": "handy_drywall_repair",
        "label": "Drywall repair / patching",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_tv_mounting",
        "label": "TV mounting",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_furniture_assembly",
        "label": "Furniture assembly",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_shelf_curtain_install",
        "label": "Shelf / curtain rod install",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_door_repair",
        "label": "Door repair or adjustment",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_fence_gate_repair",
        "label": "Fence / gate repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_pressure_washing",
        "label": "Pressure washing",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_caulking_weatherstrip",
        "label": "Caulking / weatherstripping",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_deck_repair",
        "label": "Deck repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_tile_grout_repair",
        "label": "Tile / grout repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "handy_other",
        "label": "Other",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      }
    ],
    "Appliance Repair": [
      {
        "code": "appl_refrigerator_not_cooling",
        "label": "Refrigerator not cooling",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "appl_washer_not_spinning_draining",
        "label": "Washer not spinning / draining",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "appl_dryer_not_heating",
        "label": "Dryer not heating",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "appl_dishwasher_not_cleaning",
        "label": "Dishwasher not cleaning",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "appl_oven_stove_not_heating",
        "label": "Oven / stove not heating",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "appl_ice_maker_not_working",
        "label": "Ice maker not working",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "appl_garbage_disposal_jammed",
        "label": "Garbage disposal jammed",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "appl_other",
        "label": "Other",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      }
    ],
    "Construction": [
      {
        "code": "remod_kitchen",
        "label": "Kitchen remodel",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_bathroom",
        "label": "Bathroom remodel",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_flooring_install",
        "label": "Flooring installation",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_tile_install",
        "label": "Tile installation",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_room_addition",
        "label": "Room addition",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_basement_finish",
        "label": "Basement finishing",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_deck_patio_build",
        "label": "Deck / patio build",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_cabinet_install_reface",
        "label": "Cabinet install / reface",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_countertop_install",
        "label": "Countertop installation",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "remod_other",
        "label": "Other",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      }
    ],
    "Pool & Spa": [
      {
        "code": "pool_cleaning_maintenance",
        "label": "Pool cleaning / maintenance",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "pool_pump_filter_repair",
        "label": "Pool pump or filter repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "pool_leak_detection",
        "label": "Pool leak detection",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "pool_heater_repair",
        "label": "Pool heater repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "pool_resurfacing",
        "label": "Pool resurfacing",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "pool_spa_hot_tub_service",
        "label": "Spa / hot tub service",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "pool_other",
        "label": "Other",
        "band": null,
        "price_cents": null,
        "requires_clarification": true
      }
    ],
    "Windows & Doors": [
      {
        "code": "wd_window_replacement",
        "label": "Window replacement",
        "band": "A",
        "price_cents": 7500,
        "requires_clarification": false
      },
      {
        "code": "wd_window_repair",
        "label": "Window repair",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "wd_interior_door_install",
        "label": "Interior door installation",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "wd_exterior_door_install",
        "label": "Exterior / entry door installation",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "wd_door_repair",
        "label": "Door repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "wd_sliding_door_repair",
        "label": "Sliding door repair",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "wd_storm_door_install",
        "label": "Storm door install",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "wd_screen_repair_replace",
        "label": "Screen repair / replace",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "wd_other",
        "label": "Other",
        "band": null,
        "price_cents": null,
        "requires_clarification": true
      }
    ],
    "Painting": [
      {
        "code": "paint_interior_full_room",
        "label": "Interior painting (full room)",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "paint_touchup_accent",
        "label": "Interior touch-up / accent wall",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "paint_exterior",
        "label": "Exterior painting",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "paint_cabinet_refinish",
        "label": "Cabinet painting / refinishing",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "paint_deck_fence_stain",
        "label": "Deck / fence staining",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "paint_wallpaper_removal",
        "label": "Wallpaper removal",
        "band": "C",
        "price_cents": 1800,
        "requires_clarification": false
      },
      {
        "code": "paint_popcorn_removal",
        "label": "Popcorn ceiling removal",
        "band": "B",
        "price_cents": 3500,
        "requires_clarification": false
      },
      {
        "code": "paint_other",
        "label": "Other",
        "band": null,
        "price_cents": null,
        "requires_clarification": true
      }
    ]
  }
};
});