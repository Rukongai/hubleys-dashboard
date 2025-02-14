import { getConfig } from "./sysconfig";
import { fetchTimeout } from "$lib/fetch";
import path from "path";
import { cache } from "$lib/server/httpcache";
import { chooseRandom } from "$lib/random";
import { getParticlesConfig } from "$lib/server/particles";
import { epoch } from "$lib/datetime";

export async function queryBgImgUrlReddit(subreddits: string, timeout?: number) {
    const fetchPosts = async (subreddits: string[]) => {
        const url = 'https://api.reddit.com/r/' + path.basename(subreddits.join('+')) + '/.json?limit=100'
        if (cache(url)) return cache(url)
        const response = await fetchTimeout(url, {
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            timeout
        })
        const data = await response.json()
        return cache(url, data.data.children.filter(
            post => !post.data.is_video && !post.data.stickied && post.data.url && post.data.thumbnail && ['i.imgur.com', 'i.redd.it'].includes(post.data.domain)
        ).filter(post => {
            const src = post.data.preview?.images[0].source
            if (src) {
                const { width, height } = src
                return height > 800 && width > 1000 && width / height > 1.1
            } else return false
        }).map(post => post.data.url))
    }
    return chooseRandom(await fetchPosts(subreddits.trim().split(/\s*,\s*/)))

}

export async function queryBgImgUrlUnsplash(searchTerm: string, timeout?: number) {

    const apiKey = (await getConfig()).unsplash_api_key
    if (!apiKey)
        throw new Error(('unsplash error: no api key given'))
    const search = new URLSearchParams({
        client_id: apiKey,
        orientation: 'landscape',
        query: searchTerm
    })
    const res = await fetchTimeout('https://api.unsplash.com/photos/random?' + search.toString(), { timeout })
    if (res.status === 200) {
        const data = await res.json()
        return data.urls.full
    } else {
        throw new Error('unsplash error: ' + (await res.text()))
    }
}

export async function generateCurrentBgConfig(
    { currentBgImgUrl, userConfig, timeout }: { currentBgImgUrl?: string, userConfig: UserConfig, timeout?: number }) {
    const bgCfg: BackgroundConfig = userConfig.backgrounds.find(bgCfg => bgCfg.selected)
    const particlesJob = bgCfg.particles ? getParticlesConfig(bgCfg.particles) : null

    let bgImg = null
    if (!currentBgImgUrl) {
        let bgImgUrlJob = null

        if (bgCfg.background === 'random') {
            try {
                if (bgCfg.random_image.provider === 'unsplash')
                    bgImgUrlJob = queryBgImgUrlUnsplash(bgCfg.random_image.unsplash_query, timeout)
                else if (bgCfg.random_image.provider === 'reddit')
                    bgImgUrlJob = queryBgImgUrlReddit(bgCfg.random_image.subreddits, timeout)
                else
                    console.warn('unknown background image provider:', bgCfg.random_image.provider)
            } catch (e) {
                console.error(e)
            }
        } else if (bgCfg.background === 'static') {
            if (bgCfg.static_image.source === 'upload')
                bgImgUrlJob = '/background/' + bgCfg.static_image.upload_url
            else if (bgCfg.static_image.source === 'web')
                bgImgUrlJob = bgCfg.static_image.web_url
            else
                console.warn('unknown background static image source: ', bgCfg.static_image.source)
        }

        bgImg = (async () => {
            if (bgImgUrlJob)
                try {
                    const url = await bgImgUrlJob
                    return {
                        url,
                        expiresAt: bgCfg.random_image.duration ? epoch() + bgCfg.random_image.duration : null
                    }
                } catch (e) {
                    console.error('Fetch random bg image error:', e)
                    return { error: true }
                }
            else return null
        })()
    } else {
        bgImg = { url: currentBgImgUrl }
    }


    return {
        image: await bgImg,
        triangles: bgCfg.background === 'triangles',
        particles: await particlesJob,
        blur: bgCfg.blur,
        dots: bgCfg.dots,
    }
}

export function setBgImgCookie(cookies, bgImg: null | { url: string, expiresAt?: number | null } | { error: boolean }) {
    if (bgImg && !bgImg.hasOwnProperty('error') && bgImg.hasOwnProperty('expiresAt')) {
        const expires = new Date(1970, 0, 1, 0, 0)
        if (bgImg.expiresAt) {
            expires.setSeconds(bgImg.expiresAt)
        } else if (bgImg.expiresAt === null) {
            expires.setFullYear(9999)
        }
        cookies.set('bgimg', bgImg.url, { path: '/', expires })
    }
}
