// Adapted from zokeber/venezuela-json (CC BY 4.0); attribution and corrections: README.md.
export type VenezuelaMunicipality = { id: string; name: string };
export type VenezuelaState = { id: string; name: string; municipalities: readonly VenezuelaMunicipality[]; note?: string };
export type ProfileLocation = { stateId: string; municipalityId: string };

export const venezuelaStates: readonly VenezuelaState[] = [
  {
    "id": "VE-X",
    "name": "Amazonas",
    "municipalities": [
      {
        "id": "VE-X:alto-orinoco",
        "name": "Alto Orinoco"
      },
      {
        "id": "VE-X:atabapo",
        "name": "Atabapo"
      },
      {
        "id": "VE-X:atures",
        "name": "Atures"
      },
      {
        "id": "VE-X:autana",
        "name": "Autana"
      },
      {
        "id": "VE-X:manapiare",
        "name": "Manapiare"
      },
      {
        "id": "VE-X:maroa",
        "name": "Maroa"
      },
      {
        "id": "VE-X:rio-negro",
        "name": "Río Negro"
      }
    ]
  },
  {
    "id": "VE-B",
    "name": "Anzoátegui",
    "municipalities": [
      {
        "id": "VE-B:anaco",
        "name": "Anaco"
      },
      {
        "id": "VE-B:aragua",
        "name": "Aragua"
      },
      {
        "id": "VE-B:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-B:bruzual",
        "name": "Bruzual"
      },
      {
        "id": "VE-B:cajigal",
        "name": "Cajigal"
      },
      {
        "id": "VE-B:carvajal",
        "name": "Carvajal"
      },
      {
        "id": "VE-B:diego-bautista-urbaneja",
        "name": "Diego Bautista Urbaneja"
      },
      {
        "id": "VE-B:freites",
        "name": "Freites"
      },
      {
        "id": "VE-B:guanipa",
        "name": "Guanipa"
      },
      {
        "id": "VE-B:guanta",
        "name": "Guanta"
      },
      {
        "id": "VE-B:independencia",
        "name": "Independencia"
      },
      {
        "id": "VE-B:libertad",
        "name": "Libertad"
      },
      {
        "id": "VE-B:miranda",
        "name": "Miranda"
      },
      {
        "id": "VE-B:monagas",
        "name": "Monagas"
      },
      {
        "id": "VE-B:penalver",
        "name": "Peñalver"
      },
      {
        "id": "VE-B:piritu",
        "name": "Píritu"
      },
      {
        "id": "VE-B:san-juan-de-capistrano",
        "name": "San Juan de Capistrano"
      },
      {
        "id": "VE-B:santa-ana",
        "name": "Santa Ana"
      },
      {
        "id": "VE-B:simon-rodriguez",
        "name": "Simón Rodríguez"
      },
      {
        "id": "VE-B:mcgregor",
        "name": "Sir Arthur McGregor"
      },
      {
        "id": "VE-B:sotillo",
        "name": "Sotillo"
      }
    ]
  },
  {
    "id": "VE-C",
    "name": "Apure",
    "municipalities": [
      {
        "id": "VE-C:achaguas",
        "name": "Achaguas"
      },
      {
        "id": "VE-C:biruaca",
        "name": "Biruaca"
      },
      {
        "id": "VE-C:munoz",
        "name": "Muñoz"
      },
      {
        "id": "VE-C:paez",
        "name": "Páez"
      },
      {
        "id": "VE-C:pedro-camejo",
        "name": "Pedro Camejo"
      },
      {
        "id": "VE-C:romulo-gallegos",
        "name": "Rómulo Gallegos"
      },
      {
        "id": "VE-C:san-fernando",
        "name": "San Fernando"
      }
    ]
  },
  {
    "id": "VE-D",
    "name": "Aragua",
    "municipalities": [
      {
        "id": "VE-D:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-D:camatagua",
        "name": "Camatagua"
      },
      {
        "id": "VE-D:francisco-linares-alcantara",
        "name": "Francisco Linares Alcántara"
      },
      {
        "id": "VE-D:girardot",
        "name": "Girardot"
      },
      {
        "id": "VE-D:jose-angel-lamas",
        "name": "José Ángel Lamas"
      },
      {
        "id": "VE-D:jose-felix-ribas",
        "name": "José Félix Ribas"
      },
      {
        "id": "VE-D:jose-rafael-revenga",
        "name": "José Rafael Revenga"
      },
      {
        "id": "VE-D:libertador",
        "name": "Libertador"
      },
      {
        "id": "VE-D:mario-briceno-iragorry",
        "name": "Mario Briceño Iragorry"
      },
      {
        "id": "VE-D:ocumare-de-la-costa-de-oro",
        "name": "Ocumare de la Costa de Oro"
      },
      {
        "id": "VE-D:san-casimiro",
        "name": "San Casimiro"
      },
      {
        "id": "VE-D:san-sebastian",
        "name": "San Sebastián"
      },
      {
        "id": "VE-D:santiago-marino",
        "name": "Santiago Mariño"
      },
      {
        "id": "VE-D:santos-michelena",
        "name": "Santos Michelena"
      },
      {
        "id": "VE-D:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-D:tovar",
        "name": "Tovar"
      },
      {
        "id": "VE-D:urdaneta",
        "name": "Urdaneta"
      },
      {
        "id": "VE-D:zamora",
        "name": "Zamora"
      }
    ]
  },
  {
    "id": "VE-E",
    "name": "Barinas",
    "municipalities": [
      {
        "id": "VE-E:alberto-arvelo-torrealba",
        "name": "Alberto Arvelo Torrealba"
      },
      {
        "id": "VE-E:andres-eloy-blanco",
        "name": "Andrés Eloy Blanco"
      },
      {
        "id": "VE-E:antonio-jose-de-sucre",
        "name": "Antonio José de Sucre"
      },
      {
        "id": "VE-E:arismendi",
        "name": "Arismendi"
      },
      {
        "id": "VE-E:barinas",
        "name": "Barinas"
      },
      {
        "id": "VE-E:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-E:cruz-paredes",
        "name": "Cruz Paredes"
      },
      {
        "id": "VE-E:ezequiel-zamora",
        "name": "Ezequiel Zamora"
      },
      {
        "id": "VE-E:obispos",
        "name": "Obispos"
      },
      {
        "id": "VE-E:pedraza",
        "name": "Pedraza"
      },
      {
        "id": "VE-E:rojas",
        "name": "Rojas"
      },
      {
        "id": "VE-E:sosa",
        "name": "Sosa"
      }
    ]
  },
  {
    "id": "VE-F",
    "name": "Bolívar",
    "municipalities": [
      {
        "id": "VE-F:angostura",
        "name": "Angostura"
      },
      {
        "id": "VE-F:heres",
        "name": "Angostura del Orinoco"
      },
      {
        "id": "VE-F:caroni",
        "name": "Caroní"
      },
      {
        "id": "VE-F:cedeno",
        "name": "Cedeño"
      },
      {
        "id": "VE-F:el-callao",
        "name": "El Callao"
      },
      {
        "id": "VE-F:gran-sabana",
        "name": "Gran Sabana"
      },
      {
        "id": "VE-F:padre-pedro-chien",
        "name": "Padre Pedro Chien"
      },
      {
        "id": "VE-F:piar",
        "name": "Piar"
      },
      {
        "id": "VE-F:roscio",
        "name": "Roscio"
      },
      {
        "id": "VE-F:sifontes",
        "name": "Sifontes"
      },
      {
        "id": "VE-F:sucre",
        "name": "Sucre"
      }
    ]
  },
  {
    "id": "VE-G",
    "name": "Carabobo",
    "municipalities": [
      {
        "id": "VE-G:bejuma",
        "name": "Bejuma"
      },
      {
        "id": "VE-G:carlos-arvelo",
        "name": "Carlos Arvelo"
      },
      {
        "id": "VE-G:diego-ibarra",
        "name": "Diego Ibarra"
      },
      {
        "id": "VE-G:guacara",
        "name": "Guacara"
      },
      {
        "id": "VE-G:mora",
        "name": "Juan José Mora"
      },
      {
        "id": "VE-G:libertador",
        "name": "Libertador"
      },
      {
        "id": "VE-G:los-guayos",
        "name": "Los Guayos"
      },
      {
        "id": "VE-G:miranda",
        "name": "Miranda"
      },
      {
        "id": "VE-G:montalban",
        "name": "Montalbán"
      },
      {
        "id": "VE-G:naguanagua",
        "name": "Naguanagua"
      },
      {
        "id": "VE-G:puerto-cabello",
        "name": "Puerto Cabello"
      },
      {
        "id": "VE-G:san-diego",
        "name": "San Diego"
      },
      {
        "id": "VE-G:san-joaquin",
        "name": "San Joaquín"
      },
      {
        "id": "VE-G:valencia",
        "name": "Valencia"
      }
    ]
  },
  {
    "id": "VE-H",
    "name": "Cojedes",
    "municipalities": [
      {
        "id": "VE-H:anzoategui",
        "name": "Anzoátegui"
      },
      {
        "id": "VE-H:girardot",
        "name": "Girardot"
      },
      {
        "id": "VE-H:lima-blanco",
        "name": "Lima Blanco"
      },
      {
        "id": "VE-H:pao-de-san-juan-bautista",
        "name": "Pao de San Juan Bautista"
      },
      {
        "id": "VE-H:ricaurte",
        "name": "Ricaurte"
      },
      {
        "id": "VE-H:romulo-gallegos",
        "name": "Rómulo Gallegos"
      },
      {
        "id": "VE-H:san-carlos",
        "name": "San Carlos"
      },
      {
        "id": "VE-H:tinaco",
        "name": "Tinaco"
      },
      {
        "id": "VE-H:tinaquillo",
        "name": "Tinaquillo"
      }
    ]
  },
  {
    "id": "VE-Y",
    "name": "Delta Amacuro",
    "municipalities": [
      {
        "id": "VE-Y:antonio-diaz",
        "name": "Antonio Díaz"
      },
      {
        "id": "VE-Y:casacoima",
        "name": "Casacoima"
      },
      {
        "id": "VE-Y:pedernales",
        "name": "Pedernales"
      },
      {
        "id": "VE-Y:tucupita",
        "name": "Tucupita"
      }
    ]
  },
  {
    "id": "VE-A",
    "name": "Distrito Capital",
    "municipalities": [
      {
        "id": "VE-A:libertador",
        "name": "Libertador"
      }
    ]
  },
  {
    "id": "VE-I",
    "name": "Falcón",
    "municipalities": [
      {
        "id": "VE-I:acosta",
        "name": "Acosta"
      },
      {
        "id": "VE-I:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-I:buchivacoa",
        "name": "Buchivacoa"
      },
      {
        "id": "VE-I:carirubana",
        "name": "Carirubana"
      },
      {
        "id": "VE-I:colina",
        "name": "Colina"
      },
      {
        "id": "VE-I:dabajuro",
        "name": "Dabajuro"
      },
      {
        "id": "VE-I:democracia",
        "name": "Democracia"
      },
      {
        "id": "VE-I:falcon",
        "name": "Falcón"
      },
      {
        "id": "VE-I:federacion",
        "name": "Federación"
      },
      {
        "id": "VE-I:jacura",
        "name": "Jacura"
      },
      {
        "id": "VE-I:los-taques",
        "name": "Los Taques"
      },
      {
        "id": "VE-I:manaure",
        "name": "Manaure"
      },
      {
        "id": "VE-I:mauroa",
        "name": "Mauroa"
      },
      {
        "id": "VE-I:miranda",
        "name": "Miranda"
      },
      {
        "id": "VE-I:monsenor-iturriza",
        "name": "Monseñor Iturriza"
      },
      {
        "id": "VE-I:palmasola",
        "name": "Palmasola"
      },
      {
        "id": "VE-I:petit",
        "name": "Petit"
      },
      {
        "id": "VE-I:piritu",
        "name": "Píritu"
      },
      {
        "id": "VE-I:san-francisco",
        "name": "San Francisco"
      },
      {
        "id": "VE-I:silva",
        "name": "Silva"
      },
      {
        "id": "VE-I:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-I:tocopero",
        "name": "Tocópero"
      },
      {
        "id": "VE-I:union",
        "name": "Unión"
      },
      {
        "id": "VE-I:urumaco",
        "name": "Urumaco"
      },
      {
        "id": "VE-I:zamora",
        "name": "Zamora"
      }
    ]
  },
  {
    "id": "VE-J",
    "name": "Guárico",
    "municipalities": [
      {
        "id": "VE-J:camaguan",
        "name": "Camaguán"
      },
      {
        "id": "VE-J:chaguaramas",
        "name": "Chaguaramas"
      },
      {
        "id": "VE-J:el-socorro",
        "name": "El Socorro"
      },
      {
        "id": "VE-J:miranda",
        "name": "Francisco de Miranda"
      },
      {
        "id": "VE-J:ribas",
        "name": "José Félix Ribas"
      },
      {
        "id": "VE-J:monagas",
        "name": "José Tadeo Monagas"
      },
      {
        "id": "VE-J:roscio",
        "name": "Juan Germán Roscio"
      },
      {
        "id": "VE-J:las-mercedes",
        "name": "Juan José Rondón"
      },
      {
        "id": "VE-J:mellado",
        "name": "Julián Mellado"
      },
      {
        "id": "VE-J:infante",
        "name": "Leonardo Infante"
      },
      {
        "id": "VE-J:ortiz",
        "name": "Ortiz"
      },
      {
        "id": "VE-J:san-geronimo-de-guayabal",
        "name": "San Gerónimo de Guayabal"
      },
      {
        "id": "VE-J:san-jose-de-guaribe",
        "name": "San José de Guaribe"
      },
      {
        "id": "VE-J:santa-maria-de-ipire",
        "name": "Santa María de Ipire"
      },
      {
        "id": "VE-J:zaraza",
        "name": "Zaraza"
      }
    ]
  },
  {
    "id": "VE-W",
    "name": "La Guaira",
    "municipalities": [
      {
        "id": "VE-W:vargas",
        "name": "Vargas"
      }
    ]
  },
  {
    "id": "VE-K",
    "name": "Lara",
    "municipalities": [
      {
        "id": "VE-K:andres-eloy-blanco",
        "name": "Andrés Eloy Blanco"
      },
      {
        "id": "VE-K:crespo",
        "name": "Crespo"
      },
      {
        "id": "VE-K:iribarren",
        "name": "Iribarren"
      },
      {
        "id": "VE-K:jimenez",
        "name": "Jiménez"
      },
      {
        "id": "VE-K:moran",
        "name": "Morán"
      },
      {
        "id": "VE-K:palavecino",
        "name": "Palavecino"
      },
      {
        "id": "VE-K:simon-planas",
        "name": "Simón Planas"
      },
      {
        "id": "VE-K:torres",
        "name": "Torres"
      },
      {
        "id": "VE-K:urdaneta",
        "name": "Urdaneta"
      }
    ]
  },
  {
    "id": "VE-L",
    "name": "Mérida",
    "municipalities": [
      {
        "id": "VE-L:alberto-adriani",
        "name": "Alberto Adriani"
      },
      {
        "id": "VE-L:andres-bello",
        "name": "Andrés Bello"
      },
      {
        "id": "VE-L:antonio-pinto-salinas",
        "name": "Antonio Pinto Salinas"
      },
      {
        "id": "VE-L:aricagua",
        "name": "Aricagua"
      },
      {
        "id": "VE-L:arzobispo-chacon",
        "name": "Arzobispo Chacón"
      },
      {
        "id": "VE-L:campo-elias",
        "name": "Campo Elías"
      },
      {
        "id": "VE-L:caracciolo-parra-olmedo",
        "name": "Caracciolo Parra Olmedo"
      },
      {
        "id": "VE-L:cardenal-quintero",
        "name": "Cardenal Quintero"
      },
      {
        "id": "VE-L:guaraque",
        "name": "Guaraque"
      },
      {
        "id": "VE-L:julio-cesar-salas",
        "name": "Julio César Salas"
      },
      {
        "id": "VE-L:justo-briceno",
        "name": "Justo Briceño"
      },
      {
        "id": "VE-L:libertador",
        "name": "Libertador"
      },
      {
        "id": "VE-L:miranda",
        "name": "Miranda"
      },
      {
        "id": "VE-L:obispo-ramos-de-lora",
        "name": "Obispo Ramos de Lora"
      },
      {
        "id": "VE-L:padre-noguera",
        "name": "Padre Noguera"
      },
      {
        "id": "VE-L:pueblo-llano",
        "name": "Pueblo Llano"
      },
      {
        "id": "VE-L:rangel",
        "name": "Rangel"
      },
      {
        "id": "VE-L:rivas-davila",
        "name": "Rivas Dávila"
      },
      {
        "id": "VE-L:santos-marquina",
        "name": "Santos Marquina"
      },
      {
        "id": "VE-L:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-L:tovar",
        "name": "Tovar"
      },
      {
        "id": "VE-L:tulio-febres-cordero",
        "name": "Tulio Febres Cordero"
      },
      {
        "id": "VE-L:zea",
        "name": "Zea"
      }
    ]
  },
  {
    "id": "VE-M",
    "name": "Miranda",
    "municipalities": [
      {
        "id": "VE-M:acevedo",
        "name": "Acevedo"
      },
      {
        "id": "VE-M:andres-bello",
        "name": "Andrés Bello"
      },
      {
        "id": "VE-M:baruta",
        "name": "Baruta"
      },
      {
        "id": "VE-M:brion",
        "name": "Brión"
      },
      {
        "id": "VE-M:buroz",
        "name": "Buroz"
      },
      {
        "id": "VE-M:carrizal",
        "name": "Carrizal"
      },
      {
        "id": "VE-M:chacao",
        "name": "Chacao"
      },
      {
        "id": "VE-M:cristobal-rojas",
        "name": "Cristóbal Rojas"
      },
      {
        "id": "VE-M:el-hatillo",
        "name": "El Hatillo"
      },
      {
        "id": "VE-M:guaicaipuro",
        "name": "Guaicaipuro"
      },
      {
        "id": "VE-M:independencia",
        "name": "Independencia"
      },
      {
        "id": "VE-M:lander",
        "name": "Lander"
      },
      {
        "id": "VE-M:los-salias",
        "name": "Los Salias"
      },
      {
        "id": "VE-M:paez",
        "name": "Páez"
      },
      {
        "id": "VE-M:paz-castillo",
        "name": "Paz Castillo"
      },
      {
        "id": "VE-M:pedro-gual",
        "name": "Pedro Gual"
      },
      {
        "id": "VE-M:plaza",
        "name": "Plaza"
      },
      {
        "id": "VE-M:simon-bolivar",
        "name": "Simón Bolívar"
      },
      {
        "id": "VE-M:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-M:urdaneta",
        "name": "Urdaneta"
      },
      {
        "id": "VE-M:zamora",
        "name": "Zamora"
      }
    ]
  },
  {
    "id": "VE-N",
    "name": "Monagas",
    "municipalities": [
      {
        "id": "VE-N:acosta",
        "name": "Acosta"
      },
      {
        "id": "VE-N:aguasay",
        "name": "Aguasay"
      },
      {
        "id": "VE-N:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-N:caripe",
        "name": "Caripe"
      },
      {
        "id": "VE-N:cedeno",
        "name": "Cedeño"
      },
      {
        "id": "VE-N:ezequiel-zamora",
        "name": "Ezequiel Zamora"
      },
      {
        "id": "VE-N:libertador",
        "name": "Libertador"
      },
      {
        "id": "VE-N:maturin",
        "name": "Maturín"
      },
      {
        "id": "VE-N:piar",
        "name": "Piar"
      },
      {
        "id": "VE-N:punceres",
        "name": "Punceres"
      },
      {
        "id": "VE-N:santa-barbara",
        "name": "Santa Bárbara"
      },
      {
        "id": "VE-N:sotillo",
        "name": "Sotillo"
      },
      {
        "id": "VE-N:uracoa",
        "name": "Uracoa"
      }
    ]
  },
  {
    "id": "VE-O",
    "name": "Nueva Esparta",
    "municipalities": [
      {
        "id": "VE-O:antolin-del-campo",
        "name": "Antolín del Campo"
      },
      {
        "id": "VE-O:arismendi",
        "name": "Arismendi"
      },
      {
        "id": "VE-O:diaz",
        "name": "Díaz"
      },
      {
        "id": "VE-O:garcia",
        "name": "García"
      },
      {
        "id": "VE-O:gomez",
        "name": "Gómez"
      },
      {
        "id": "VE-O:maneiro",
        "name": "Maneiro"
      },
      {
        "id": "VE-O:marcano",
        "name": "Marcano"
      },
      {
        "id": "VE-O:marino",
        "name": "Mariño"
      },
      {
        "id": "VE-O:peninsula-de-macanao",
        "name": "Península de Macanao"
      },
      {
        "id": "VE-O:tubores",
        "name": "Tubores"
      },
      {
        "id": "VE-O:villalba",
        "name": "Villalba"
      }
    ]
  },
  {
    "id": "VE-P",
    "name": "Portuguesa",
    "municipalities": [
      {
        "id": "VE-P:agua-blanca",
        "name": "Agua Blanca"
      },
      {
        "id": "VE-P:araure",
        "name": "Araure"
      },
      {
        "id": "VE-P:esteller",
        "name": "Esteller"
      },
      {
        "id": "VE-P:guanare",
        "name": "Guanare"
      },
      {
        "id": "VE-P:guanarito",
        "name": "Guanarito"
      },
      {
        "id": "VE-P:monsenor-jose-vicente-de-unda",
        "name": "Monseñor José Vicente de Unda"
      },
      {
        "id": "VE-P:ospino",
        "name": "Ospino"
      },
      {
        "id": "VE-P:paez",
        "name": "Páez"
      },
      {
        "id": "VE-P:papelon",
        "name": "Papelón"
      },
      {
        "id": "VE-P:san-genaro-de-boconoito",
        "name": "San Genaro de Boconoíto"
      },
      {
        "id": "VE-P:san-rafael-de-onoto",
        "name": "San Rafael de Onoto"
      },
      {
        "id": "VE-P:santa-rosalia",
        "name": "Santa Rosalía"
      },
      {
        "id": "VE-P:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-P:turen",
        "name": "Turén"
      }
    ]
  },
  {
    "id": "VE-R",
    "name": "Sucre",
    "municipalities": [
      {
        "id": "VE-R:andres-eloy-blanco",
        "name": "Andrés Eloy Blanco"
      },
      {
        "id": "VE-R:andres-mata",
        "name": "Andrés Mata"
      },
      {
        "id": "VE-R:arismendi",
        "name": "Arismendi"
      },
      {
        "id": "VE-R:benitez",
        "name": "Benítez"
      },
      {
        "id": "VE-R:bermudez",
        "name": "Bermúdez"
      },
      {
        "id": "VE-R:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-R:cajigal",
        "name": "Cajigal"
      },
      {
        "id": "VE-R:cruz-salmeron-acosta",
        "name": "Cruz Salmerón Acosta"
      },
      {
        "id": "VE-R:libertador",
        "name": "Libertador"
      },
      {
        "id": "VE-R:marino",
        "name": "Mariño"
      },
      {
        "id": "VE-R:mejia",
        "name": "Mejía"
      },
      {
        "id": "VE-R:montes",
        "name": "Montes"
      },
      {
        "id": "VE-R:ribero",
        "name": "Ribero"
      },
      {
        "id": "VE-R:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-R:valdez",
        "name": "Valdez"
      }
    ]
  },
  {
    "id": "VE-S",
    "name": "Táchira",
    "municipalities": [
      {
        "id": "VE-S:andres-bello",
        "name": "Andrés Bello"
      },
      {
        "id": "VE-S:antonio-romulo-costa",
        "name": "Antonio Rómulo Costa"
      },
      {
        "id": "VE-S:ayacucho",
        "name": "Ayacucho"
      },
      {
        "id": "VE-S:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-S:cardenas",
        "name": "Cárdenas"
      },
      {
        "id": "VE-S:cordoba",
        "name": "Córdoba"
      },
      {
        "id": "VE-S:fernandez-feo",
        "name": "Fernández Feo"
      },
      {
        "id": "VE-S:francisco-de-miranda",
        "name": "Francisco de Miranda"
      },
      {
        "id": "VE-S:garcia-de-hevia",
        "name": "García de Hevia"
      },
      {
        "id": "VE-S:guasimos",
        "name": "Guásimos"
      },
      {
        "id": "VE-S:independencia",
        "name": "Independencia"
      },
      {
        "id": "VE-S:jauregui",
        "name": "Jáuregui"
      },
      {
        "id": "VE-S:jose-maria-vargas",
        "name": "José María Vargas"
      },
      {
        "id": "VE-S:junin",
        "name": "Junín"
      },
      {
        "id": "VE-S:libertad",
        "name": "Libertad"
      },
      {
        "id": "VE-S:libertador",
        "name": "Libertador"
      },
      {
        "id": "VE-S:lobatera",
        "name": "Lobatera"
      },
      {
        "id": "VE-S:michelena",
        "name": "Michelena"
      },
      {
        "id": "VE-S:panamericano",
        "name": "Panamericano"
      },
      {
        "id": "VE-S:pedro-maria-urena",
        "name": "Pedro María Ureña"
      },
      {
        "id": "VE-S:rafael-urdaneta",
        "name": "Rafael Urdaneta"
      },
      {
        "id": "VE-S:samuel-dario-maldonado",
        "name": "Samuel Darío Maldonado"
      },
      {
        "id": "VE-S:san-cristobal",
        "name": "San Cristóbal"
      },
      {
        "id": "VE-S:san-judas-tadeo",
        "name": "San Judas Tadeo"
      },
      {
        "id": "VE-S:seboruco",
        "name": "Seboruco"
      },
      {
        "id": "VE-S:simon-rodriguez",
        "name": "Simón Rodríguez"
      },
      {
        "id": "VE-S:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-S:torbes",
        "name": "Torbes"
      },
      {
        "id": "VE-S:uribante",
        "name": "Uribante"
      }
    ]
  },
  {
    "id": "VE-T",
    "name": "Trujillo",
    "municipalities": [
      {
        "id": "VE-T:andres-bello",
        "name": "Andrés Bello"
      },
      {
        "id": "VE-T:bocono",
        "name": "Boconó"
      },
      {
        "id": "VE-T:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-T:candelaria",
        "name": "Candelaria"
      },
      {
        "id": "VE-T:carache",
        "name": "Carache"
      },
      {
        "id": "VE-T:escuque",
        "name": "Escuque"
      },
      {
        "id": "VE-T:jose-felipe-marquez-canizalez",
        "name": "José Felipe Márquez Cañizales"
      },
      {
        "id": "VE-T:juan-vicente-campos-elias",
        "name": "Juan Vicente Campo Elías"
      },
      {
        "id": "VE-T:la-ceiba",
        "name": "La Ceiba"
      },
      {
        "id": "VE-T:miranda",
        "name": "Miranda"
      },
      {
        "id": "VE-T:monte-carmelo",
        "name": "Monte Carmelo"
      },
      {
        "id": "VE-T:motatan",
        "name": "Motatán"
      },
      {
        "id": "VE-T:pampan",
        "name": "Pampán"
      },
      {
        "id": "VE-T:pampanito",
        "name": "Pampanito"
      },
      {
        "id": "VE-T:rafael-rangel",
        "name": "Rafael Rangel"
      },
      {
        "id": "VE-T:san-rafael-de-carvajal",
        "name": "San Rafael de Carvajal"
      },
      {
        "id": "VE-T:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-T:trujillo",
        "name": "Trujillo"
      },
      {
        "id": "VE-T:urdaneta",
        "name": "Urdaneta"
      },
      {
        "id": "VE-T:valera",
        "name": "Valera"
      }
    ]
  },
  {
    "id": "VE-U",
    "name": "Yaracuy",
    "municipalities": [
      {
        "id": "VE-U:aristides-bastidas",
        "name": "Arístides Bastidas"
      },
      {
        "id": "VE-U:bolivar",
        "name": "Bolívar"
      },
      {
        "id": "VE-U:bruzual",
        "name": "Bruzual"
      },
      {
        "id": "VE-U:cocorote",
        "name": "Cocorote"
      },
      {
        "id": "VE-U:independencia",
        "name": "Independencia"
      },
      {
        "id": "VE-U:jose-antonio-paez",
        "name": "José Antonio Páez"
      },
      {
        "id": "VE-U:la-trinidad",
        "name": "La Trinidad"
      },
      {
        "id": "VE-U:manuel-monge",
        "name": "Manuel Monge"
      },
      {
        "id": "VE-U:nirgua",
        "name": "Nirgua"
      },
      {
        "id": "VE-U:pena",
        "name": "Peña"
      },
      {
        "id": "VE-U:san-felipe",
        "name": "San Felipe"
      },
      {
        "id": "VE-U:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-U:urachiche",
        "name": "Urachiche"
      },
      {
        "id": "VE-U:veroes",
        "name": "Veroes"
      }
    ]
  },
  {
    "id": "VE-V",
    "name": "Zulia",
    "municipalities": [
      {
        "id": "VE-V:almirante-padilla",
        "name": "Almirante Padilla"
      },
      {
        "id": "VE-V:baralt",
        "name": "Baralt"
      },
      {
        "id": "VE-V:cabimas",
        "name": "Cabimas"
      },
      {
        "id": "VE-V:catatumbo",
        "name": "Catatumbo"
      },
      {
        "id": "VE-V:colon",
        "name": "Colón"
      },
      {
        "id": "VE-V:francisco-javier-pulgar",
        "name": "Francisco Javier Pulgar"
      },
      {
        "id": "VE-V:paez",
        "name": "Guajira"
      },
      {
        "id": "VE-V:jesus-enrique-lossada",
        "name": "Jesús Enrique Lossada"
      },
      {
        "id": "VE-V:jesus-maria-semprun",
        "name": "Jesús María Semprún"
      },
      {
        "id": "VE-V:la-canada-de-urdaneta",
        "name": "La Cañada de Urdaneta"
      },
      {
        "id": "VE-V:lagunillas",
        "name": "Lagunillas"
      },
      {
        "id": "VE-V:machiques-de-perija",
        "name": "Machiques de Perijá"
      },
      {
        "id": "VE-V:mara",
        "name": "Mara"
      },
      {
        "id": "VE-V:maracaibo",
        "name": "Maracaibo"
      },
      {
        "id": "VE-V:miranda",
        "name": "Miranda"
      },
      {
        "id": "VE-V:rosario-de-perija",
        "name": "Rosario de Perijá"
      },
      {
        "id": "VE-V:san-francisco",
        "name": "San Francisco"
      },
      {
        "id": "VE-V:santa-rita",
        "name": "Santa Rita"
      },
      {
        "id": "VE-V:simon-bolivar",
        "name": "Simón Bolívar"
      },
      {
        "id": "VE-V:sucre",
        "name": "Sucre"
      },
      {
        "id": "VE-V:valmore-rodriguez",
        "name": "Valmore Rodríguez"
      }
    ]
  },
  {
    "id": "dependencias-federales",
    "name": "Dependencias Federales",
    "municipalities": [],
    "note": "Entidad insular sin división municipal. No se inventan municipios."
  },
  {
    "id": "guayana-esequiba",
    "name": "Guayana Esequiba (territorio en disputa)",
    "municipalities": [],
    "note": "Territorio en disputa, reclamado por Venezuela y administrado por Guyana. No hay un catálogo municipal venezolano verificado para esta zona."
  }
];

export const demoProfileLocation: ProfileLocation = { stateId: 'VE-A', municipalityId: 'VE-A:libertador' };
export function isProfileLocation(value: unknown): value is ProfileLocation {
  if (!value || typeof value !== 'object' || !('stateId' in value) || !('municipalityId' in value)) return false;
  return venezuelaStates.some(state => state.id === value.stateId && state.municipalities.some(m => m.id === value.municipalityId));
}
export function profileLocationLabel(location: ProfileLocation): string {
  const state = venezuelaStates.find(item => item.id === location.stateId);
  const municipality = state?.municipalities.find(item => item.id === location.municipalityId);
  if (!state || !municipality) throw new Error('La ubicación del perfil no pertenece al catálogo territorial.');
  return municipality.name + ' · ' + state.name;
}
