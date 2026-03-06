# PV-Notstrom Setup-Anleitung

## 1. Package in Home Assistant einbinden

In `configuration.yaml` hinzufügen:

```yaml
homeassistant:
  packages:
    pv_notstrom_helpers: !include packages/pv_notstrom/helpers.yaml
    pv_notstrom_templates: !include packages/pv_notstrom/templates.yaml
    pv_notstrom_scripts: !include packages/pv_notstrom/scripts.yaml
    pv_notstrom_automations: !include packages/pv_notstrom/automations.yaml
```

Alternativ mit Package-Verzeichnis:

```yaml
homeassistant:
  packages: !include_dir_named packages/pv_notstrom/
```

## 2. Labels in Home Assistant anlegen

Gehe zu **Einstellungen → Labels** und erstelle diese 4 Labels:

| Label | Farbe | Beschreibung |
|-------|-------|-------------|
| `notstrom_stufe1` | Rot | Sofort aus bei Stromausfall |
| `notstrom_stufe2` | Gelb | Aus bei niedrigem Batteriestand |
| `notstrom_stufe3` | Grün | Nie abschalten |
| `notstrom_ignorieren` | Grau | Nicht relevant für Notstrom |

## 3. Labels den Entities zuweisen

### Stufe 1 — Sofort aus (Label: `notstrom_stufe1`)

- `climate.410_bedroom`
- `climate.410_living_room`
- `climate.411_living_room`
- `climate.420_guest_room`
- `climate.420_living_room`
- `climate.420_master_bedroom`
- `climate.430_guest_room`
- `climate.430_kids_room`
- `climate.living_room`
- `climate.master_bedroom`
- `switch.410_boiler`
- `switch.411_boiler`
- `switch.430_boiler`
- `media_player.apt_430_the_frame_43_gq43ls03aauxzg`
- `media_player.kinderzimmer`

### Stufe 2 — Bei SOC < 30% (Label: `notstrom_stufe2`)

- `switch.410_fridge`
- `switch.411_fridge`
- `light.kuche`
- `light.wohnbereich`
- `light.wohnzimmer_2`
- `light.terrasse`
- `light.aussen`
- `light.aussenbeleuchtung`
- `light.durchgang`
- `switch.steckdose_sofa_1_leer`

### Stufe 3 — Nie abschalten (Label: `notstrom_stufe3`)

- `switch.steckdose_sofa_4_home_assistant`
- `switch.steckdose_sofa_2_poe_switch`
- `switch.steckdose_sofa_3_hue_bridge`
- `switch.septic_system`

### Ignorieren (Label: `notstrom_ignorieren`)

Für Entities die nicht in die Notstrom-Logik sollen (z.B. Kamera-Switches,
Automation-Switches, etc.):

- `switch.automation_*` (alle Automation-Schalter)
- `switch.zavala_*` (Kamera-Switches)
- `switch.kinderzimmer_*` (Sonos-Switches)
- `switch.wohnzimmer_*` (Sonos-Switches)

## 4. Dashboard einrichten

### Voraussetzung: auto-entities HACS-Karte

1. HACS → Frontend → "auto-entities" suchen und installieren
2. Browser-Cache leeren

### Dashboard hinzufügen

1. Lovelace → Drei-Punkte-Menü → Dashboard bearbeiten
2. Neue View "Notstrom" hinzufügen
3. Inhalt aus `dashboard.yaml` einfügen

## 5. Huawei Solar Integration (TODO)

Sobald der Modbus-Zugang freigeschaltet ist:

1. HACS → huawei_solar konfigurieren (IP des Dongles, Port 502)
2. Entity-IDs prüfen: `sensor.battery_state_of_capacity`, Grid-Status
3. In `templates.yaml` den Stromausfall-Sensor anpassen
4. In `automations.yaml` die Battery-SOC Entity-ID prüfen

## 6. Testen

1. **Simulation Stromausfall:** Developer Tools → States → `binary_sensor.stromausfall` auf `on` setzen
2. **Schwellwert testen:** `input_number.pv_notstrom_schwellwert_stufe2` auf 100% setzen
3. **Scripts einzeln testen:** Developer Tools → Services → `script.pv_notstrom_stufe_aus` mit `stufe: notstrom_stufe1`
4. **Recovery testen:** `input_number.pv_notstrom_recovery_schwellwert` auf 0% setzen
