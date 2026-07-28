#!/usr/bin/env bash
# ============================================================
# Pipeline mensual - Cumplimiento de Jornada Laboral
# Uso:
#   ./run_all.sh /ruta/a/los/excel/del/mes  2026
#
# Coloca en la carpeta indicada TODOS los archivos
# REPORTE_DE_RELOJ_CHECADOR_<MARCA>_<SUCURSAL>_<MES>_<ANIO>.xlsx
# del mes que quieras analizar (los 20+ de todas las unidades).
# ============================================================
set -e
DATA_DIR="${1:?Uso: ./run_all.sh <carpeta_con_excels> <anio_referencia_ej_2026>}"
ANIO_REF="${2:-2026}"
# Opcional: exporta estas variables antes de correr el script si ya conoces a los firmantes del mes, p.ej.
#   ELABORA="Juan Pérez" RECIBE="María López" VOBO="Ana Torres" ./run_all.sh ./data 2026
# Si se omiten, los reportes dejan el espacio en blanco para firmar a mano (comportamiento anterior).
FIRMA_ARGS=()
[ -n "${ELABORA:-}" ] && FIRMA_ARGS+=(--elabora "$ELABORA")
[ -n "${RECIBE:-}" ] && FIRMA_ARGS+=(--recibe "$RECIBE")
[ -n "${VOBO:-}" ] && FIRMA_ARGS+=(--vobo "$VOBO")
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/salida_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT/reportes_pdf"

echo "== 1/4 ETL: leyendo archivos de $DATA_DIR =="
python3 "$HERE/etl.py" --data-dir "$DATA_DIR" --config "$HERE/config_normativo.json" \
  --out "$OUT/dataset.json" --anio-ref "$ANIO_REF"

echo "== 2/4 Calculando KPIs =="
python3 "$HERE/build_kpis.py" --dataset "$OUT/dataset.json" --out "$OUT/kpis.json"

echo "== 3/4 Generando Excel de auditoría =="
python3 "$HERE/build_excel_auditoria.py" --dataset "$OUT/dataset.json" --kpis "$OUT/kpis.json" \
  --out "$OUT/Base_Consolidada_Auditoria.xlsx" --logo "$HERE/logos/chesa.png" "${FIRMA_ARGS[@]}"

echo "== 4/4 Generando PDFs por unidad de negocio =="
python3 "$HERE/build_pdf_reports.py" --kpis "$OUT/kpis.json" --dataset "$OUT/dataset.json" \
  --out-dir "$OUT/reportes_pdf" --logos-dir "$HERE/logos" "${FIRMA_ARGS[@]}"

echo "== Armando el tablero HTML (VACÍO, sin datos precargados) =="
python3 "$HERE/build_dashboard.py" --template "$HERE/dashboard_template.html" \
  --config "$HERE/config_normativo.json" --anio-ref "$ANIO_REF" \
  --chartjs "$HERE/vendor/chart.umd.js" --xlsxjs "$HERE/vendor/xlsx.mini.min.js" \
  --jspdf "$HERE/vendor/jspdf.umd.min.js" --autotable "$HERE/vendor/jspdf.plugin.autotable.min.js" \
  --logos-dir "$HERE/logos" --out "$OUT/Tablero_Cumplimiento_Jornada_Laboral.html"
# Nota: el tablero se genera VACÍO a propósito — es la herramienta reutilizable que
# abres cada mes y en la que arrastras los .xlsx del mes en curso (sección 01 — Datos).
# No hace falta volver a correr run_all.sh solo para "actualizar" el tablero; los
# archivos Excel y PDF de esta corrida sí llevan los datos de $DATA_DIR, para respaldo.
# Si de verdad quieres una FOTO del tablero con los datos de este mes ya cargados
# (por ejemplo para archivar una versión de solo lectura), corre:
#   python3 build_dashboard.py --template dashboard_template.html --dataset "$OUT/dataset.json" \
#     --chartjs vendor/chart.umd.js --xlsxjs vendor/xlsx.mini.min.js --jspdf vendor/jspdf.umd.min.js \
#     --autotable vendor/jspdf.plugin.autotable.min.js --logos-dir logos --out Tablero_MAYO_2026_snapshot.html

echo ""
echo "LISTO. Resultados en: $OUT"
echo "  - Tablero_Cumplimiento_Jornada_Laboral.html   (tablero reutilizable, se abre VACÍO)"
echo "  - Base_Consolidada_Auditoria.xlsx             (respaldo documental completo de este mes)"
echo "  - reportes_pdf/                               (un PDF por unidad, listo para firma)"
