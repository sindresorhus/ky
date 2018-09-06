<div align="center">
	<br>
	<div>
		<img width="600" height="600" src="media/logo.svg" alt="ky">
	</div>
	<br>
	<br>
	<br>
</div>

> Ky est un minuscule et élégant client HTTP basé sur l'[API Fetch](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch) du navigateur.

[![Build Status](https://travis-ci.com/sindresorhus/ky.svg?branch=master)](https://travis-ci.com/sindresorhus/ky) [![codecov](https://codecov.io/gh/sindresorhus/ky/branch/master/graph/badge.svg)](https://codecov.io/gh/sindresorhus/ky)

Ky cible les [navigateurs modernes](#browser-support). Pour les navigateurs plus anciens, vous devrez transpiler et utiliser un [polyfill pour `fetch`](https://github.com/github/fetch). Pour Node.js, jetez un oeil à [Got](https://github.com/sindresorhus/got).

1 KB *(minifié & gunzippé)*, un seul fichier, et aucune dépendance.


## Bénéfices par rapport à un simple `fetch`

- API plus simple,
- Raccourcis pour les méthodes (`ky.post()`),
- Traitements des statuts non-200 comme étant des erreurs,
- Rejeux des requêtes ayant échouées,
- JSON en option,
- Support du Timeout,
- Instances avec des comportements par défaut customisables,


## Installation

```
$ npm install ky
```

<a href="https://www.patreon.com/sindresorhus">
	<img src="https://c5.patreon.com/external/logo/become_a_patron_button@2x.png" width="160">
</a>


## Utilisation

```js
import ky from 'ky';

(async () => {
	const json = await ky.post('https://some-api.com', {json: {foo: true}}).json();

	console.log(json);
	//=> `{data: '🦄'}`
})();
```

Avec un simple `fetch`, ça donnerait:

```js
(async () => {
	class HTTPError extends Error {}

	const response = await fetch('https://sindresorhus.com', {
		method: 'POST',
		body: JSON.stringify({foo: true}),
		headers: {
			'content-type': 'application/json'
		}
	});

	if (!response.ok) {
		throw new HTTPError(`Fetch error:`, response.statusText);
	}

	const json = await response.json();

	console.log(json);
	//=> `{data: '🦄'}`
})();
```


## API

### ky(input, [options])

Les paramètres `input` et `options` sont les mêmes que ceux de [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch), avec quelques exceptions:

- L'option `credentials` a pour valeur par défaut `same-origin`, qui est aussi la valeur par défaut dans la spec, mais tout les navigateurs ne l'ont pas encore gérée.
- Plus d'options ont été ajoutées. Voir ci-dessous.

Retourne un [objet `Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) avec des [méthodes `Body`](https://developer.mozilla.org/en-US/docs/Web/API/Body#Methods) ajouté par commodité. Donc vous pouvez, par exemple, appeler `ky.json()` directement sur l'objet `Response` sans avoir à l'attendre avant. C'est l'inverse pour les méthodes `Body` de `window.Fetch`; elles lèveront une erreur `HTTPError` si le status de la réponse n'est pas dans l'intervalle `200...299`.

#### options

Type: `Object`

##### json

Type: `Object`

Raccourci pour envoyé du JSON. Utilisé celle-ci plutôt que l'option `body`. Elle accepte un simple objet qui sera transformé en chaîne de caractères avec `JSON.stringify()` et le bon header sera défini pour vous.

### ky.get(input, [options])
### ky.post(input, [options])
### ky.put(input, [options])
### ky.patch(input, [options])
### ky.head(input, [options])
### ky.delete(input, [options])

Définit la valeur de `options.method` associée au nom de la méthode et exécute la requête.

#### retry

Type: `number`<br>
Default: `2`

Rejoue les requêtes ayant échoué et exécutées avec l'une des méthodes ci-dessous et dont le résultat est une erreur réseau ou un des statuts ci-dessous.

Méthodes: `GET` `PUT` `HEAD` `DELETE` `OPTIONS` `TRACE`<br>
Statuts: [`408`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/408) [`413`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413) [`429`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429) [`500`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500) [`502`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/502) [`503`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503) [`504`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504)

#### timeout

Type: `number`<br>
Default: `10000`

Timeout en millisecondes appliqué lors de la récupération d'une réponse.

### ky.extend(defaultOptions)

Crée une nouvelle instance de `ky` avec des options par défaut que vous pouvez surcharger avec les vôtres.

#### defaultOptions

Type: `Object`

### ky.HTTPError

Exposé pour tester avec `instanceof`. L'erreur a une propriété `response` avec l'[objet `Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).

### ky.TimeoutError

L'erreur levée lorsqu'une requête tombe en timeout.


## Astuces

### Annulation

Fetch (et par conséquent Ky) supporte nativement l'annulation de requête au travers de l'[API `AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController). [Pour en savoir plus.](https://developers.google.com/web/updates/2017/09/abortable-fetch)

Exemple:

```js
import ky from 'ky';

const controller = new AbortController();
const {signal} = controller;

setTimeout(() => controller.abort(), 5000);

(async () => {
	try {
		console.log(await ky(url, {signal}).text());
	} catch (error) {
		if (error.name === 'AbortError') {
		  console.log('Fetch aborted');
		} else {
		  console.error('Fetch error:', error);
		}
	}
})();
```


## FAQ

#### En quoi est-ce différent de [`r2`](https://github.com/mikeal/r2) ?

Consultez ma réponse dans le ticket [#10](https://github.com/sindresorhus/ky/issues/10).


## Support navigateur

La dernière version de Chrome, Firefox, et Safari.


## Voir aussi

- [got](https://github.com/sindresorhus/got) - Requête HTTP simplifiée pour Node.js


## License

MIT © [Sindre Sorhus](https://sindresorhus.com)
