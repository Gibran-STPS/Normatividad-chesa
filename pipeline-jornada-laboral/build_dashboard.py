#!/usr/bin/env python3
"""Combina dashboard_template.html + dataset.json + librerías (Chart.js, SheetJS) + logos + app.js en un único HTML.

Por defecto (sin --dataset) genera el tablero VACÍO: se abre sin ninguna unidad
precargada, listo para arrastrar los archivos del mes desde el navegador. Esto
es lo que se recomienda distribuir como la herramienta reutilizable de cada mes.

Si se pasa --dataset (por ejemplo el dataset.json que genera etl.py), el tablero
se entrega con esos datos ya cargados — útil solo para una foto/respaldo de un
mes en particular, no como la herramienta de trabajo diaria."""
import argparse, os, json, base64, datetime

def build_blank_dataset(config_path, anio_ref):
    with open(config_path, encoding='utf-8') as f:
        config = json.load(f)
    return {
        'generado': datetime.datetime.now().isoformat(),
        'anio_referencia': anio_ref,
        'normativa': config,
        'unidades_negocio': [], 'registros_diarios': [], 'semanal': [],
        'retardos_resumen': [], 'faltas_resumen': [],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--template', required=True)
    ap.add_argument('--dataset', default=None, help='dataset.json con datos reales de un mes (opcional). '
        'Si se omite, el tablero se genera VACÍO (recomendado para la herramienta reutilizable de cada mes).')
    ap.add_argument('--config', default=None, help='config_normativo.json, usado solo para generar el tablero vacío '
        'cuando no se pasa --dataset. Por defecto busca config_normativo.json junto al template.')
    ap.add_argument('--anio-ref', default='2026', help='Año de referencia para el tablero vacío (ignorado si se pasa --dataset).')
    ap.add_argument('--app-js', default=None)
    ap.add_argument('--chartjs', default=None, help='Ruta a chart.umd.js')
    ap.add_argument('--xlsxjs', default=None, help='Ruta a xlsx.mini.min.js (SheetJS)')
    ap.add_argument('--jspdf', default=None, help='Ruta a jspdf.umd.min.js')
    ap.add_argument('--autotable', default=None, help='Ruta a jspdf.plugin.autotable.min.js')
    ap.add_argument('--logos-dir', default=None, help='Carpeta con chesa.png, nissan.png, renault.png, changan.png')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(args.template))
    app_js_path = args.app_js or os.path.join(here, 'app.js')
    chartjs_path = args.chartjs or os.path.join(here, 'vendor', 'chart.umd.js')
    xlsxjs_path = args.xlsxjs or os.path.join(here, 'vendor', 'xlsx.mini.min.js')
    jspdf_path = args.jspdf or os.path.join(here, 'vendor', 'jspdf.umd.min.js')
    autotable_path = args.autotable or os.path.join(here, 'vendor', 'jspdf.plugin.autotable.min.js')
    logos_dir = args.logos_dir or os.path.join(here, 'logos')

    html = open(args.template, encoding='utf-8').read()
    if args.dataset:
        dataset_json = open(args.dataset, encoding='utf-8').read()
    else:
        config_path = args.config or os.path.join(here, 'config_normativo.json')
        dataset_json = json.dumps(build_blank_dataset(config_path, args.anio_ref), ensure_ascii=False)
        print('Sin --dataset: generando tablero VACÍO (sin unidades precargadas).')
    app_js = open(app_js_path, encoding='utf-8').read()
    chartjs = open(chartjs_path, encoding='utf-8').read()
    xlsxjs = open(xlsxjs_path, encoding='utf-8').read()
    jspdf = open(jspdf_path, encoding='utf-8').read()
    autotable = open(autotable_path, encoding='utf-8').read()

    logos = {}
    for name in ['chesa', 'nissan', 'renault', 'changan']:
        p = os.path.join(logos_dir, f'{name}.png')
        with open(p, 'rb') as f:
            logos[name] = base64.b64encode(f.read()).decode('ascii')
    logos_json = json.dumps(logos)

    dataset_json_safe = dataset_json.replace('</script>', '<\\/script>')
    html = html.replace('__KPI_JSON__', dataset_json_safe)
    html = html.replace('__LOGOS_JSON__', logos_json)
    html = html.replace('__APP_JS__', app_js)
    html = html.replace('__CHARTJS_LIB__', chartjs.replace('</script>', '<\\/script>'))
    html = html.replace('__XLSX_LIB__', xlsxjs.replace('</script>', '<\\/script>'))
    html = html.replace('__JSPDF_LIB__', jspdf.replace('</script>', '<\\/script>'))
    html = html.replace('__AUTOTABLE_LIB__', autotable.replace('</script>', '<\\/script>'))

    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('Dashboard escrito en', args.out, '-', len(html), 'bytes')

if __name__ == '__main__':
    main()
