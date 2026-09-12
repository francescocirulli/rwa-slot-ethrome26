// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {SlotPrize1155} from "../src/SlotPrize1155.sol";

contract SlotPrize1155Test is Test {
    address private constant RECIPIENT = address(0xBEEF);
    address private constant OTHER = address(0xCAFE);

    SlotPrize1155 private prizes;

    function setUp() public {
        prizes = new SlotPrize1155(address(this));
    }

    function testLaunchIdsAndMetadataAreAvailableOnChain() public view {
        assertEq(prizes.GADGET(), 1);
        assertEq(prizes.ENS_REGISTRATION(), 2);
        assertEq(prizes.URBE_HUB_DAY_PASS(), 3);
        assertEq(prizes.SHIRT(), 4);
        assertEq(prizes.nextTokenId(), 5);

        for (uint256 tokenId = 1; tokenId <= 4; ++tokenId) {
            assertTrue(prizes.tokenExists(tokenId));
            assertTrue(_startsWith(prizes.uri(tokenId), "data:application/json;base64,"));
        }
    }

    function testOwnerCanMintExistingIdToReceiver() public {
        prizes.mint(RECIPIENT, prizes.GADGET(), 12);
        assertEq(prizes.balanceOf(RECIPIENT, prizes.GADGET()), 12);
    }

    function testOwnerCanCreateAndMintNewSequentialIds() public {
        string memory metadataURI = "data:application/json;base64,e30=";
        uint256 tokenId = prizes.createAndMint(RECIPIENT, 7, metadataURI);

        assertEq(tokenId, 5);
        assertEq(prizes.nextTokenId(), 6);
        assertEq(prizes.uri(tokenId), metadataURI);
        assertEq(prizes.balanceOf(RECIPIENT, tokenId), 7);

        prizes.mint(OTHER, tokenId, 3);
        assertEq(prizes.balanceOf(OTHER, tokenId), 3);
    }

    function testNonOwnerCannotMint() public {
        uint256 tokenId = prizes.SHIRT();
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER));
        prizes.mint(RECIPIENT, tokenId, 1);
    }

    function testUnknownIdCannotBeMintedOrRead() public {
        vm.expectRevert(abi.encodeWithSelector(SlotPrize1155.UnknownToken.selector, 5));
        prizes.mint(RECIPIENT, 5, 1);

        vm.expectRevert(abi.encodeWithSelector(SlotPrize1155.UnknownToken.selector, 5));
        prizes.uri(5);
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
