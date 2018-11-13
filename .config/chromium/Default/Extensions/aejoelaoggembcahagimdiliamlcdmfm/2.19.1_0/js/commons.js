/*
 * Copyright 2010-2017 Restlet S.A.S. All rights reserved.
 * Restlet is registered trademark of Restlet S.A.S.
 */

import { cloneDeep, concat, map, reduce, set } from 'lodash';
import { DOMParser } from 'xmldom';
import xpath from 'xpath';

const parseXml = (xmlAsString) => {
  return new DOMParser().parseFromString(xmlAsString);
};

export function evaluateXpath(xpathSelector, xmlAsString) {
  return xpath.evaluate(
    xpathSelector,
    parseXml(xmlAsString),
    null, // namespaceResolver
    xpath.XPathResult.ANY_TYPE, // resultType
    null
  );
}

const XML_CHILD_TYPES = {
  ARRAY_ITEM: 'ARRAY_ITEM',
  SINGLE_ELEMENT: 'SINGLE_ELEMENT',
  ATTRIBUTE: 'ATTRIBUTE'
};

export function getXmlChildrenTags(parentSelector, xmlAsString) {
  const childrenKeys = map(evaluateXpath(`${parentSelector}/*`, xmlAsString).nodes, (node) => node.nodeName);

  const occurrencesByKey = reduce(
    childrenKeys,
    (seed, key) => {
      const newSeed = cloneDeep(seed);
      const total = seed[ key ] ? seed[ key ].total + 1 : 1;
      return set(newSeed, key, { index: 1, total });
    },
    {}
  );

  const childrenElements = map(childrenKeys, (key) => {
    if (occurrencesByKey[ key ].total > 1) {
      const index = occurrencesByKey[ key ].index++;
      return {
        type: XML_CHILD_TYPES.ARRAY_ITEM,
        key,
        index,
        selector: `/${key}[${index}]`
      };
    }

    return {
      type: XML_CHILD_TYPES.SINGLE_ELEMENT,
      key,
      selector: `/${key}`
    };
  });

  const attributeElements = map(
    evaluateXpath(`${parentSelector}/@*`, xmlAsString).nodes,
    (node) => {
      const key = node.nodeName;
      return {
        type: XML_CHILD_TYPES.ATTRIBUTE,
        key,
        selector: `/@${key}`
      };
    }
  );

  return concat(childrenElements, attributeElements);
}

export function evaluateXpathWithRhino(xpathSelector, xmlAsString) {
  const result = evaluateXpath(xpathSelector, xmlAsString);

  let resultType;
  switch (result.resultType) {
    case 0:
      resultType = 'Any';
      break;
    case 1:
      resultType = 'Number';
      break;
    case 2:
      resultType = 'String';
      break;
    case 3:
      resultType = 'Boolean';
      break;
    case 4:
      resultType = 'UnorderedNodeIterator';
      break;
    case 5:
      resultType = 'OrderedNodeIterator';
      break;
    case 6:
      resultType = 'UnorderedNodeSnapshot';
      break;
    case 7:
      resultType = 'OrderedNodeSnapshot';
      break;
    case 8:
      resultType = 'AnyUnorderedNode';
      break;
    case 9:
      resultType = 'FirstOrderedNode';
      break;

    default:
      throw new Error(`Unsupported XPath result type ${result.resultType}`);
  }

  return JSON.stringify({
    resultType: resultType,
    booleanValue: result.booleanValue,
    stringValue: result.stringValue,
    numberValue: result.numberValue,
    matchingNodes: result.nodes ?
      result.nodes.map(n => {
        return {
          name: n.name,
          stringValue: n.toString()
        };
      }) :
      []
  });
}
