const normalizeData = require('normalize-package-data')
const parseLicense = require('spdx-expression-parse')
const npa = require('npm-package-arg')
const ssri = require('ssri')
const uuid = require('uuid')

const CYCLONEDX_SCHEMA = 'https://cyclonedx.org/schema/bom-1.4.schema.json'
const CYCLONEDX_FORMAT = 'CycloneDX'
const CYCLONEDX_SCHEMA_VERSION = '1.4'

const PROP_PATH = 'cdx:npm:package:path'
const PROP_BUNDLED = 'cdx:npm:package:bundled'
const PROP_DEVELOPMENT = 'cdx:npm:package:development'
const PROP_EXTRANEOUS = 'cdx:npm:package:extraneous'
const PROP_PRIVATE = 'cdx:npm:package:private'

const REF_VCS = 'vcs'
const REF_WEBSITE = 'website'
const REF_ISSUE_TRACKER = 'issue-tracker'
const REF_DISTRIBUTION = 'distribution'

const ALGO_MAP = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
}

const cyclonedxOutput = ({ npm, nodes, packageType }) => {
  const rootNode = nodes.find(node => node.isRoot)
  const childNodes = nodes.filter(node => !node.isRoot)

  const bom = {
    $schema: CYCLONEDX_SCHEMA,
    bomFormat: CYCLONEDX_FORMAT,
    specVersion: CYCLONEDX_SCHEMA_VERSION,
    serialNumber: `urn:uuid:${uuid.v4()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'npm',
          name: 'cli',
          version: npm.version,
        },
      ],
      component: toCyclonedxItem(rootNode, { packageType }),
    },
    components: childNodes.map(toCyclonedxItem),
    dependencies: nodes.map(node => toCyclonedxDependency(node, nodes)),
  }

  return bom
}

const toCyclonedxItem = (node, { packageType }) => {
  packageType = packageType || 'library'
  const purl = npa.toPurl(node.pkgid) + (isGitNode(node) ? `?vcs_url=${node.resolved}` : '')

  normalizeData(node.package)

  const component = {
    'bom-ref': node.pkgid,
    type: packageType,
    name: node.name,
    version: node.version,
    scope: (node.optional || node.devOptional) ? 'optional' : 'required',
    author: (typeof node.package?.author === 'object')
      ? node.package.author.name
      : (node.package?.author || undefined),
    description: node.package?.description || undefined,
    purl: purl,
    properties: [{
      name: PROP_PATH,
      value: node.location,
    }],
    externalReferences: [],
  }

  if (node.integrity) {
    const integrity = ssri.parse(node.integrity, { single: true })
    component.hashes = [{
      alg: ALGO_MAP[integrity.algorithm] || 'SHA-512',
      content: integrity.hexDigest(),
    }]
  }

  if (node.dev === true) {
    component.properties.push(prop(PROP_DEVELOPMENT))
  }

  if (node.package?.private === true) {
    component.properties.push(prop(PROP_PRIVATE))
  }

  if (node.extraneous === true) {
    component.properties.push(prop(PROP_EXTRANEOUS))
  }

  if (node.inBundle === true) {
    component.properties.push(prop(PROP_BUNDLED))
  }

  if (!node.isLink && node.resolved) {
    component.externalReferences.push(extRef(REF_DISTRIBUTION, node.resolved))
  }

  if (node.package?.repository?.url) {
    component.externalReferences.push(extRef(REF_VCS, node.package.repository.url))
  }

  if (node.package?.homepage) {
    component.externalReferences.push(extRef(REF_WEBSITE, node.package.homepage))
  }

  if (node.package?.bugs?.url) {
    component.externalReferences.push(extRef(REF_ISSUE_TRACKER, node.package.bugs.url))
  }

  try {
    const parsedLicense = parseLicense(node.package?.license)
    
    // If license is a single SPDX license, use the license field
    if (parsedLicense && parsedLicense.license) {
      component.licenses = [ { license: { id: parsedLicense.license } } ]
    // If license is a conjunction, use the expression field
    } else if (parsedLicense && parsedLicense.conjunction) {
      component.licenses = [ { expression: node.package.license } ]
    }
  } catch (err) {
    // ignore
  }

  return component
}

const toCyclonedxDependency = (node, nodes) => {
  return {
    ref: node.pkgid,
    dependsOn: [...node.edgesOut.values()]
      // Filter out edges that are linking to nodes not in the list
      .filter(edge => nodes.find(n => n.pkgid === edge.to?.pkgid))
      .map(edge => edge.to ? edge.to.pkgid : undefined)
      .filter(id => id),
  }
}

const prop = (name) => ({ name, value: 'true' })

const extRef = (type, url) => ({ type, url })

const isGitNode = (node) => {
  if (!node.resolved) {
    return
  }

  try {
    const { type } = npa(node.resolved)
    return type === 'git' || type === 'hosted'
  } catch (err) {
    return false
  }
}

module.exports = { cyclonedxOutput }