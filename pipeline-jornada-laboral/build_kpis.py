#!/usr/bin/env python3
"""Genera kpis.json (compacto, listo para el dashboard) a partir de dataset.json"""
import json, argparse, os
from collections import defaultdict

def build_simulador_transicion(weekly, normativa):
    anios = sorted(k for k in normativa['jornada_ordinaria_maxima_semanal_por_anio'] if not k.startswith('_'))
    serie_global = []
    for anio in anios:
        limite = normativa['jornada_ordinaria_maxima_semanal_por_anio'][anio]
        total = len(weekly)
        cumple = sum(1 for w in weekly if w['horas_semana'] <= limite)
        serie_global.append({
            'anio': anio, 'limite': limite,
            'pct_cumplimiento': round(100 * cumple / total, 1) if total else None,
        })
    anio_meta = anios[-1]
    limite_meta = normativa['jornada_ordinaria_maxima_semanal_por_anio'][anio_meta]
    por_unidad = defaultdict(list)
    for w in weekly:
        por_unidad[w['unidad_negocio']].append(w['horas_semana'])
    detalle_por_unidad = []
    for u, horas in por_unidad.items():
        promedio = sum(horas) / len(horas)
        cumple_meta = sum(1 for h in horas if h <= limite_meta)
        detalle_por_unidad.append({
            'unidad_negocio': u,
            'horas_promedio_semana_actual': round(promedio, 1),
            'pct_cumplimiento_meta': round(100 * cumple_meta / len(horas), 1),
            'brecha_horas_meta': round(max(0, promedio - limite_meta), 1),
        })
    detalle_por_unidad.sort(key=lambda x: -x['brecha_horas_meta'])
    return {'anio_meta': anio_meta, 'limite_meta': limite_meta, 'serie_global': serie_global,
            'detalle_por_unidad': detalle_por_unidad}

def build(dataset):
    daily = dataset['registros_diarios']
    weekly = dataset['semanal']
    retardos_resumen = dataset['retardos_resumen']
    faltas_resumen = dataset['faltas_resumen']
    unidades_meta = {u['unidad_negocio']: u for u in dataset['unidades_negocio']}

    # ---- data quality: unidades sin hoja de faltas ----
    calidad_datos = []
    for u, meta in unidades_meta.items():
        if not meta.get('tiene_hoja_dias_sin_checadas', True):
            calidad_datos.append({
                'unidad_negocio': u,
                'tipo': 'FALTANTE',
                'detalle': "No incluyó hoja 'Dias Sin Checadas'. Las faltas mostradas para esta unidad se derivaron "
                           "directamente de las checadas diarias (días sin entrada ni salida), pero esa hoja podría "
                           "traer información adicional (p. ej. justificantes); se recomienda solicitar el dato a "
                           "RRHH local antes de firmar."
            })

    # ---- por unidad ----
    emp_por_unidad = defaultdict(set)
    for r in daily:
        emp_por_unidad[r['unidad_negocio']].add(r['id_empleado'])
    # Colaboradores que solo aparecen en "Días sin checadas" (ya reconciliados en faltas_resumen)
    # no tienen filas en las checadas diarias, pero sí pertenecen a la unidad: deben contarse.
    for f in faltas_resumen:
        emp_por_unidad[f['unidad_negocio']].add(f['id_empleado'])

    unidades = {}
    for u in unidades_meta:
        unidades[u] = {
            'unidad_negocio': u, 'marca': unidades_meta[u]['marca'],
            'sucursal': unidades_meta[u]['sucursal'],
            'total_colaboradores': len(emp_por_unidad[u]),
            'total_dias_registrados': 0, 'horas_totales': 0.0,
            'exceso_diario': 0, 'checadas_incompletas': 0, 'retardo_dias': 0,
            'retardo_6_12': 0, 'retardo_13_24': 0, 'retardo_mas_25': 0,
            'semanas_totales': 0, 'semanas_cumple': 0, 'semanas_excede_tope_extra': 0,
            'faltas_total': 0, 'sabados_registrados': 0, 'sabados_fuera_horario': 0,
            'colaboradores_marcaje_completo': 0,
        }

    areas = defaultdict(lambda: {
        'total_dias_registrados': 0, 'horas_totales': 0.0, 'exceso_diario': 0,
        'checadas_incompletas': 0, 'retardo_dias': 0, 'empleados': set()
    })

    for r in daily:
        u = unidades[r['unidad_negocio']]
        u['total_dias_registrados'] += 1
        if r['horas_trabajadas']:
            u['horas_totales'] += r['horas_trabajadas']
        if r['jornada_excesiva_dia']:
            u['exceso_diario'] += 1
        if r['checada_incompleta']:
            u['checadas_incompletas'] += 1
        if r['retardo']:
            u['retardo_dias'] += 1
        u['retardo_6_12'] += int(r['retardo_6_12'])
        u['retardo_13_24'] += int(r['retardo_13_24'])
        u['retardo_mas_25'] += int(r['retardo_mas_25'])
        if r.get('jornada_sabado'):
            u['sabados_registrados'] += 1
            if r.get('sabado_fuera_horario'):
                u['sabados_fuera_horario'] += 1

        ak = (r['unidad_negocio'], r['area'])
        a = areas[ak]
        a['total_dias_registrados'] += 1
        a['empleados'].add(r['id_empleado'])
        if r['horas_trabajadas']:
            a['horas_totales'] += r['horas_trabajadas']
        if r['jornada_excesiva_dia']:
            a['exceso_diario'] += 1
        if r['checada_incompleta']:
            a['checadas_incompletas'] += 1
        if r['retardo']:
            a['retardo_dias'] += 1

    for w in weekly:
        u = unidades[w['unidad_negocio']]
        u['semanas_totales'] += 1
        if w['cumple_semana']:
            u['semanas_cumple'] += 1
        if w['excede_tope_horas_extra']:
            u['semanas_excede_tope_extra'] += 1

    for f in faltas_resumen:
        unidades[f['unidad_negocio']]['faltas_total'] += f['total_faltas']
        if f.get('departamento'):
            areas[(f['unidad_negocio'], f['departamento'])]['empleados'].add(f['id_empleado'])

    # ---- colaboradores con marcaje diario completo (4 marcaciones entre semana, 2 en sábado) ----
    emp_marcaje_ok = {}
    for r in daily:
        key = (r['unidad_negocio'], r['id_empleado'])
        emp_marcaje_ok[key] = emp_marcaje_ok.get(key, True) and bool(r.get('registro_diario_completo'))
    for (u, _emp), ok in emp_marcaje_ok.items():
        if ok and u in unidades:
            unidades[u]['colaboradores_marcaje_completo'] += 1
    total_colaboradores_marcaje_completo = sum(1 for ok in emp_marcaje_ok.values() if ok)

    for u in unidades.values():
        u['pct_cumplimiento_semanal'] = round(100 * u['semanas_cumple'] / u['semanas_totales'], 1) if u['semanas_totales'] else None
        u['horas_totales'] = round(u['horas_totales'], 1)
        u['horas_promedio_colaborador'] = round(u['horas_totales'] / u['total_colaboradores'], 1) if u['total_colaboradores'] else 0

    areas_out = []
    for (u, a_name), v in areas.items():
        areas_out.append({
            'unidad_negocio': u, 'area': a_name,
            'total_colaboradores': len(v['empleados']),
            'total_dias_registrados': v['total_dias_registrados'],
            'horas_totales': round(v['horas_totales'], 1),
            'exceso_diario': v['exceso_diario'],
            'checadas_incompletas': v['checadas_incompletas'],
            'retardo_dias': v['retardo_dias'],
        })

    # ---- incidencias detalladas ----
    exceso_diario = [{
        'unidad_negocio': r['unidad_negocio'], 'area': r['area'], 'id_empleado': r['id_empleado'],
        'nombre': r['nombre'], 'fecha': r['fecha'], 'horas_trabajadas': r['horas_trabajadas'],
        'entrada': r['entrada'], 'salida': r['salida']
    } for r in daily if r['jornada_excesiva_dia']]
    exceso_diario.sort(key=lambda x: -x['horas_trabajadas'])

    exceso_semanal = [{
        'unidad_negocio': w['unidad_negocio'], 'area': w['area'], 'id_empleado': w['id_empleado'],
        'nombre': w['nombre'], 'semana_iso': w['semana_iso'], 'horas_semana': w['horas_semana'],
        'limite_aplicable': w['limite_semanal_aplicable'], 'exceso': w['exceso_semanal'],
        'excede_tope_horas_extra': w['excede_tope_horas_extra']
    } for w in weekly if not w['cumple_semana']]
    exceso_semanal.sort(key=lambda x: -x['exceso'])

    checadas_incompletas = defaultdict(lambda: {'total': 0, 'fechas': []})
    for r in daily:
        if r['checada_incompleta']:
            k = (r['unidad_negocio'], r['area'], r['id_empleado'], r['nombre'])
            checadas_incompletas[k]['total'] += 1
            checadas_incompletas[k]['fechas'].append(r['fecha'])
    checadas_incompletas_out = [{
        'unidad_negocio': k[0], 'area': k[1], 'id_empleado': k[2], 'nombre': k[3],
        'total': v['total'], 'fechas': v['fechas']
    } for k, v in checadas_incompletas.items()]
    checadas_incompletas_out.sort(key=lambda x: -x['total'])

    retardos_emp = [r for r in retardos_resumen if (r['total_6_12'] + r['total_13_24'] + r['total_mas_25']) > 0]
    for r in retardos_emp:
        r['total_retardos'] = r['total_6_12'] + r['total_13_24'] + r['total_mas_25']
    retardos_emp.sort(key=lambda x: -x['total_retardos'])

    faltas_emp = [f for f in faltas_resumen if f['total_faltas'] > 0]
    faltas_emp.sort(key=lambda x: -x['total_faltas'])

    sabados_fuera_horario = [{
        'unidad_negocio': r['unidad_negocio'], 'area': r['area'], 'id_empleado': r['id_empleado'],
        'nombre': r['nombre'], 'fecha': r['fecha'], 'horario_teorico': r['horario_teorico'],
        'entrada': r['entrada'], 'salida': r['salida'], 'horas_trabajadas': r['horas_trabajadas'],
    } for r in daily if r.get('jornada_sabado') and r.get('sabado_fuera_horario')]
    sabados_fuera_horario.sort(key=lambda x: -(x['horas_trabajadas'] or 0))

    return {
        'generado': dataset['generado'],
        'anio_referencia': dataset['anio_referencia'],
        'normativa': dataset['normativa'],
        'unidades': list(unidades.values()),
        'areas': areas_out,
        'calidad_datos': calidad_datos,
        'incidencias': {
            'exceso_diario': exceso_diario,
            'exceso_semanal': exceso_semanal,
            'checadas_incompletas': checadas_incompletas_out,
            'retardos': retardos_emp,
            'faltas': faltas_emp,
            'sabados_fuera_horario': sabados_fuera_horario,
        },
        'simulador_transicion': build_simulador_transicion(weekly, dataset['normativa']),
        'totales_globales': {
            'colaboradores': sum(len(v) for v in emp_por_unidad.values()),
            'unidades_negocio': len(unidades),
            'registros_diarios': len(daily),
            'exceso_diario': len(exceso_diario),
            'exceso_semanal': len(exceso_semanal),
            'checadas_incompletas': sum(v['total'] for v in checadas_incompletas.values()),
            'faltas': sum(f['total_faltas'] for f in faltas_resumen),
            'retardos': sum(r['total_retardos'] for r in retardos_emp),
            'sabados_fuera_horario': len(sabados_fuera_horario),
            'colaboradores_marcaje_completo': total_colaboradores_marcaje_completo,
        }
    }

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    with open(args.dataset, encoding='utf-8') as f:
        dataset = json.load(f)
    kpis = build(dataset)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(kpis, f, ensure_ascii=False)
    print('kpis.json escrito en', args.out)
    print('Tamaño:', os.path.getsize(args.out), 'bytes')
