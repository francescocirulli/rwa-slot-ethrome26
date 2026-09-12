// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {ExpandBasePrizeCatalog} from "../script/ExpandBasePrizeCatalog.s.sol";

contract ExpandBasePrizeCatalogTest is Test {
    ExpandBasePrizeCatalog private expansion;

    function setUp() public {
        expansion = new ExpandBasePrizeCatalog();
    }

    function testPhysicalPrizeIdsAndMetadataAreStable() public view {
        assertEq(expansion.BOOKS_TOKEN_ID(), 6);
        assertEq(expansion.WATER_BOTTLE_TOKEN_ID(), 7);
        assertEq(expansion.CAPS_TOKEN_ID(), 8);
        assertEq(expansion.TARGET_INVENTORY(), 20);

        string memory books = expansion.booksMetadataURI();
        string memory bottle = expansion.waterBottleMetadataURI();
        string memory caps = expansion.capsMetadataURI();
        assertTrue(_startsWith(books, "data:application/json;base64,"));
        assertTrue(_startsWith(bottle, "data:application/json;base64,"));
        assertTrue(_startsWith(caps, "data:application/json;base64,"));
        assertTrue(keccak256(bytes(books)) != keccak256(bytes(bottle)));
        assertTrue(keccak256(bytes(bottle)) != keccak256(bytes(caps)));
    }

    function _startsWith(string memory value, string memory prefix) private pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        if (valueBytes.length < prefixBytes.length) return false;
        for (uint256 i; i < prefixBytes.length; ++i) {
            if (valueBytes[i] != prefixBytes[i]) return false;
        }
        return true;
    }
}
