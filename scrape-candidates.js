#!/usr/bin/env node

const URL = require('url');
const assert = require('assert');
const cheerio = require('cheerio');
const argv = require('yargs')
    .options({
        house: {
            type: 'boolean',
            describe: 'get House candidates instead of Senate',
        },
    })
    .strict(true)
    .argv;
const YAML = require('js-yaml');
const request = require('./request');
const stateAbbreviations = require('./state-abbreviations');
const year = 2020;
const senateUrl = 'https://ballotpedia.org/United_States_Senate_elections,_' + year;
const houseUrl = senateUrl.replace('Senate', 'House_of_Representatives');

const promise = argv.house ? processChamber('House', houseUrl) : processChamber('Senate', senateUrl);
promise.then(function (candidates) {
    const count = Object.values(candidates).length;
    if (argv.house) {
        assert.strictEqual(count, 435, 'Should have 435 House seats');
    }
    else {
        assert.ok(count >= 33, 'Should have at least 33 Senate seats');
    }
    process.stdout.write(YAML.safeDump(candidates));
});

async function processChamber(chamber, url) {
    let $ = await getCheerio(url);
    const $links = $('table.infobox small a').get()
        .map(a => $(a));
    assert(
        chamber === 'Senate' ? ($links.length >= 33) : ($links.length === 50),
        `Not enough links for ${chamber} (${$links.length})`
    );
    const candidates = {};
    const getParent = span => $(span).parent();
    for (const $link of $links) {
        const state = $link.text().trim();
        const stateAbbr = stateAbbreviations[state];
        assert(stateAbbr, `Unknown state "${state}"`);
        const stateUrl = URL.resolve(url, $link.attr('href'));
        console.warn(state);
        $ = await getCheerio(stateUrl);
        let $headers = $('[id^=District_]').get()
            .map(getParent);
        if (!$headers.length) {
            $headers = [$('#Candidates, #Candidates_and_election_results').parent()];
        }
        for (const $header of $headers) {
            assert.strictEqual($header.length, 1, `Can't find Candidates header (${state})`);
            let key = stateAbbr;
            if (chamber === 'House') {
                const district = $header.text().trim();
                const m = district.match(/^District (\d+)/);
                key += (m ? m[1] : '1').padStart(2, '0');
            }
            candidates[key] = getCandidatesAfterHeader($header, state);
        }
    }
    return candidates;
}

function getCheerio(requestOptions) {
    return request(requestOptions)
        .then(html => cheerio.load(html));
}

function getCandidatesAfterHeader($header, state) {
    const $ = cheerio;
    let $p = $header.next();
    let election;
    const candidates = {};
    while ($p.length) {
        if ($p.is('h2, h3')) {
            break;
        }
        if ($p.is('ul')) {
            assert(typeof election !== 'undefined', `Election not found (${state})`);
            assert(typeof candidates[election] === 'undefined', `Duplicate election (${election}, ${state})`);
            candidates[election] = $p.find('li').get()
                .map(function (item) {
                    return $(item).text()
                        .replace(/\xa0/g, ' ')
                        .trim();
                });
        }
        else {
            const text = $p.text().replace(/\xa0/g, ' ')
                .trim();
            const m = text.match(/(\w+ \w+|Primary)\s+candidates$/);
            if (m) {
                election = m[1];
            }
            else if (/^No\s+(?:\w+\s+)?candidate\s+has|^General election candidates will be added/.test(text)) {
                assert(typeof election !== 'undefined', `Election not found (${state})`);
                assert(typeof candidates[election] === 'undefined', `Duplicate election (${election}, ${state})`);
                candidates[election] = [];
            }
            else if (/^Withdrew/.test(text)) {
                $p = $p.next(); // skip list of withdrawn candidates
                assert($p.is('ul'), `Expected ul for withdrawn candidates (${state})`);
            }
            else if (text !== '' && !/^Note:/.test(text)) {
                console.log(`Unexpected text "${text}"`);
            }
        }
        $p = $p.next();
    }

    /*
    for (const election of ['General election', 'Democratic primary', 'Republican primary']) {
        assert(candidates[election], `Missing ${election}`);
    }
    */
    return candidates;
}
