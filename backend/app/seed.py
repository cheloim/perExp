from sqlalchemy.orm import Session
from app.models import Category

BASE_HIERARCHY = [
    {
        "parent": {"name": "Alimentación", "color": "#ef4444"},
        "children": [
            {"name": "Supermercado",    "color": "#f87171", "keywords": "supermercado,carrefour,dia,jumbo,coto,walmart,disco,vea,hipermercado,maxi"},
            {"name": "Restaurantes",    "color": "#fca5a5", "keywords": "restaurante,bistro,parrilla,pizza,burger,mcdonalds,burger king,subway,kentucky,wendy"},
            {"name": "Delivery",        "color": "#fee2e2", "keywords": "rappi,pedidosya,glovo,delivery,mercadito,pedidos ya"},
            {"name": "Almacén/Kiosco", "color": "#fecaca", "keywords": "almacen,kiosco,minimercado,despensa,buffet,cafe,panaderia,verduleria"},
        ],
    },
    {
        "parent": {"name": "Transporte", "color": "#f97316"},
        "children": [
            {"name": "Combustible",             "color": "#fb923c", "keywords": "nafta,combustible,shell,ypf,axion,bp,petrobras,puma,gasoil"},
            {"name": "Transporte Público",      "color": "#fdba74", "keywords": "colectivo,tren,subte,sube,metrobus,ecobici"},
            {"name": "Taxi/Remis",              "color": "#fed7aa", "keywords": "uber,cabify,taxi,remis,didi,beat,indrive"},
            {"name": "Peaje & Estacionamiento", "color": "#ffedd5", "keywords": "peaje,estacionamiento,parking,cochera,autopista,aupass"},
        ],
    },
    {
        "parent": {"name": "Entretenimiento", "color": "#8b5cf6"},
        "children": [
            {"name": "Streaming",      "color": "#a78bfa", "keywords": "netflix,spotify,youtube,hbo,disney,amazon,twitch,apple tv,paramount,star plus,flow,directv"},
            {"name": "Juegos",         "color": "#c4b5fd", "keywords": "steam,playstation,xbox,nintendo,epic games,gaming,game pass"},
            {"name": "Cine & Salidas", "color": "#ddd6fe", "keywords": "cine,teatro,boliche,bar,pub,recital,museo,circo,hoyts,cinemark"},
        ],
    },
    {
        "parent": {"name": "Salud", "color": "#10b981"},
        "children": [
            {"name": "Farmacia",    "color": "#34d399", "keywords": "farmacia,drogueria,farmacias del pueblo,farmacity"},
            {"name": "Médicos",     "color": "#6ee7b7", "keywords": "medico,dentista,clinica,hospital,consultorio,odontologo,psicólogo,pediatra,oftalmologo"},
            {"name": "Prepaga",     "color": "#a7f3d0", "keywords": "osde,swiss medical,medicus,omint,galeno,ioma,pami,obra social,prepaga"},
            {"name": "Laboratorio", "color": "#d1fae5", "keywords": "laboratorio,análisis,estudio,bioquímica,tomografía,resonancia,radiografía"},
        ],
    },
    {
        "parent": {"name": "Hogar & Servicios", "color": "#6366f1"},
        "children": [
            {"name": "Expensas",          "color": "#818cf8", "keywords": "expensas,administración,consorcio"},
            {"name": "Electricidad & Gas", "color": "#a5b4fc", "keywords": "electricidad,gas,edenor,edesur,metrogas,naturgy,camuzzi,litoral gas,enel"},
            {"name": "Internet & Cable",  "color": "#c7d2fe", "keywords": "internet,cablevision,telecom,fibertel,claro hogar,arlink,cable"},
            {"name": "Telefonía",         "color": "#e0e7ff", "keywords": "celular,movistar,personal,claro,telefonía,adt,alarm"},
        ],
    },
    {
        "parent": {"name": "Indumentaria", "color": "#06b6d4"},
        "children": [
            {"name": "Ropa",       "color": "#22d3ee", "keywords": "ropa,zara,h&m,forever 21,mango,kosiuko,rapsodia,markova,ayres,wanama"},
            {"name": "Calzado",    "color": "#67e8f9", "keywords": "zapatillas,calzado,adidas,nike,puma,fila,topper,reef,sarkany"},
            {"name": "Accesorios", "color": "#a5f3fc", "keywords": "fravega,shopping,musimundo,cardon,joyeria,reloj,bolso,cartera"},
        ],
    },
    {
        "parent": {"name": "Educación", "color": "#f59e0b"},
        "children": [
            {"name": "Cursos Online",       "color": "#fbbf24", "keywords": "udemy,coursera,platzi,domestika,linkedin learning,edx,skillshare"},
            {"name": "Instituto & Colegio", "color": "#fcd34d", "keywords": "colegio,facultad,universidad,instituto,escuela,jardín,arancel"},
            {"name": "Librería & Libros",   "color": "#fde68a", "keywords": "librería,libro,papelería,corrugado,amazon libros"},
        ],
    },
    {
        "parent": {"name": "Viajes", "color": "#14b8a6"},
        "children": [
            {"name": "Alojamiento",        "color": "#2dd4bf", "keywords": "hotel,airbnb,booking,hostel,posada,apart,cabana,despegar alojamiento"},
            {"name": "Vuelos & Traslados", "color": "#5eead4", "keywords": "vuelo,aerolíneas,latam,flybondi,despegar,aeropuerto,flecha bus,via bariloche,andesmar,crucero"},
        ],
    },
    {
        "parent": {"name": "Finanzas", "color": "#22c55e"},
        "children": [
            {"name": "Bonificación",         "color": "#4ade80", "keywords": "bonificacion,descuento,reintegro,cashback,devolucion,promocion"},
            {"name": "Devolución Impuestos", "color": "#86efac", "keywords": "percepcion,percepción,iibb,ingresos brutos,devolucion imp,reintegro imp,imp iva,impuesto"},
        ],
    },
]


def _apply_base_hierarchy(db: Session) -> dict:
    created = 0
    updated = 0

    for group in BASE_HIERARCHY:
        pd = group["parent"]
        existing_parent = db.query(Category).filter(Category.name == pd["name"]).first()

        if existing_parent:
            if existing_parent.keywords:
                existing_parent.name = f"{pd['name']} General"
                existing_parent.parent_id = None
                db.flush()
            parent_cat = db.query(Category).filter(Category.name == pd["name"]).first()
            if not parent_cat:
                parent_cat = Category(name=pd["name"], color=pd["color"], keywords="", parent_id=None)
                db.add(parent_cat)
                db.flush()
                created += 1
                if existing_parent.name == f"{pd['name']} General":
                    existing_parent.parent_id = parent_cat.id
                    updated += 1
        else:
            parent_cat = Category(name=pd["name"], color=pd["color"], keywords="", parent_id=None)
            db.add(parent_cat)
            db.flush()
            created += 1

        for cd in group["children"]:
            existing_child = db.query(Category).filter(Category.name == cd["name"]).first()
            if existing_child:
                if existing_child.parent_id != parent_cat.id:
                    existing_child.parent_id = parent_cat.id
                    updated += 1
            else:
                db.add(Category(name=cd["name"], color=cd["color"], keywords=cd["keywords"], parent_id=parent_cat.id))
                created += 1

    db.commit()
    return {"created": created, "updated": updated}
