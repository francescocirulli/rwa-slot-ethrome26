// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {DigitalSlotMachine} from "../src/DigitalSlotMachine.sol";
import {SlotPrize1155} from "../src/SlotPrize1155.sol";

/// @notice Expands the recorded Base prize collection and slot without redeploying either contract.
/// @dev Safe to rerun after a partially submitted broadcast: existing IDs and configurations are verified.
contract ExpandBasePrizeCatalog is Script {
    using Strings for uint256;

    uint256 public constant BASE_MAINNET_CHAIN_ID = 8_453;
    address public constant PRIZE_COLLECTION = 0x8D411D8efCDb0d528E4F6659B44223264Fd0B719;
    address public constant SLOT_MACHINE = 0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c;

    uint256 public constant BOOKS_TOKEN_ID = 6;
    uint256 public constant WATER_BOTTLE_TOKEN_ID = 7;
    uint256 public constant CAPS_TOKEN_ID = 8;
    uint256 public constant TARGET_INVENTORY = 20;

    uint8 public constant BOOKS_SYMBOL = 12;
    uint8 public constant WATER_BOTTLE_SYMBOL = 13;
    uint8 public constant CAPS_SYMBOL = 14;

    function run() external {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "ExpandBasePrizeCatalog: wrong chain");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        SlotPrize1155 collection = SlotPrize1155(PRIZE_COLLECTION);
        DigitalSlotMachine slot = DigitalSlotMachine(SLOT_MACHINE);

        require(collection.owner() == deployer, "ExpandBasePrizeCatalog: deployer is not collection owner");
        require(slot.hasRole(slot.GAME_MANAGER_ROLE(), deployer), "ExpandBasePrizeCatalog: missing manager role");
        require(slot.activeRoundCount() == 0, "ExpandBasePrizeCatalog: active rounds");

        vm.startBroadcast(deployerKey);
        _ensureExistingInventory(collection, 1);
        _ensureExistingInventory(collection, 2);
        _ensureExistingInventory(collection, 3);
        _ensureExistingInventory(collection, 4);
        _ensureExistingInventory(collection, 5);
        _ensureCreated(collection, BOOKS_TOKEN_ID, booksMetadataURI());
        _ensureCreated(collection, WATER_BOTTLE_TOKEN_ID, waterBottleMetadataURI());
        _ensureCreated(collection, CAPS_TOKEN_ID, capsMetadataURI());

        _ensureNoWinWeight(slot);
        _ensurePrize(slot, BOOKS_SYMBOL, BOOKS_TOKEN_ID, 20);
        _ensurePrize(slot, WATER_BOTTLE_SYMBOL, WATER_BOTTLE_TOKEN_ID, 21);
        _ensurePrize(slot, CAPS_SYMBOL, CAPS_TOKEN_ID, 50);
        vm.stopBroadcast();

        require(collection.nextTokenId() == 9, "ExpandBasePrizeCatalog: unexpected next token ID");
        for (uint256 tokenId = 1; tokenId <= CAPS_TOKEN_ID; ++tokenId) {
            require(
                collection.balanceOf(SLOT_MACHINE, tokenId) == TARGET_INVENTORY,
                "ExpandBasePrizeCatalog: wrong inventory"
            );
        }
        require(slot.configuredPrizeCount() == 15, "ExpandBasePrizeCatalog: incomplete catalog");
        require(slot.noWinWeight() == 10, "ExpandBasePrizeCatalog: wrong no-win weight");
        require(slot.totalOutcomeWeight() == 1_000, "ExpandBasePrizeCatalog: incomplete probability total");
    }

    function _ensureExistingInventory(SlotPrize1155 collection, uint256 tokenId) private {
        require(collection.tokenExists(tokenId), "ExpandBasePrizeCatalog: existing ID missing");
        uint256 balance = collection.balanceOf(SLOT_MACHINE, tokenId);
        require(balance <= TARGET_INVENTORY, "ExpandBasePrizeCatalog: inventory exceeds target");
        if (balance < TARGET_INVENTORY) collection.mint(SLOT_MACHINE, tokenId, TARGET_INVENTORY - balance);
    }

    function _ensureCreated(SlotPrize1155 collection, uint256 tokenId, string memory metadataURI) private {
        uint256 nextTokenId = collection.nextTokenId();
        if (nextTokenId == tokenId) {
            uint256 createdTokenId = collection.createAndMint(SLOT_MACHINE, TARGET_INVENTORY, metadataURI);
            require(createdTokenId == tokenId, "ExpandBasePrizeCatalog: wrong created ID");
            return;
        }

        require(nextTokenId > tokenId, "ExpandBasePrizeCatalog: create IDs in order");
        require(collection.tokenExists(tokenId), "ExpandBasePrizeCatalog: created ID missing");
        require(
            keccak256(bytes(collection.uri(tokenId))) == keccak256(bytes(metadataURI)),
            "ExpandBasePrizeCatalog: metadata mismatch"
        );
        _ensureExistingInventory(collection, tokenId);
    }

    function _ensureNoWinWeight(DigitalSlotMachine slot) private {
        uint16 currentWeight = slot.noWinWeight();
        require(currentWeight == 101 || currentWeight == 10, "ExpandBasePrizeCatalog: unexpected no-win weight");
        if (currentWeight != 10) slot.setNoWinWeight(10);
    }

    function _ensurePrize(DigitalSlotMachine slot, uint8 symbol, uint256 tokenId, uint16 fiveMatchWeight) private {
        DigitalSlotMachine.Prize memory prize = slot.getPrize(symbol);
        if (prize.kind == DigitalSlotMachine.PrizeKind.None) {
            slot.configurePrize(
                symbol, DigitalSlotMachine.PrizeKind.ERC1155, PRIZE_COLLECTION, tokenId, 1, 0, fiveMatchWeight
            );
            return;
        }

        require(prize.kind == DigitalSlotMachine.PrizeKind.ERC1155, "ExpandBasePrizeCatalog: wrong prize kind");
        require(prize.token == PRIZE_COLLECTION, "ExpandBasePrizeCatalog: wrong prize collection");
        require(prize.tokenId == tokenId, "ExpandBasePrizeCatalog: wrong prize token ID");
        require(prize.fiveMatchAmount == 1, "ExpandBasePrizeCatalog: wrong prize amount");
        require(prize.threeMatchWeight == 0, "ExpandBasePrizeCatalog: wrong 3/5 weight");
        require(prize.fiveMatchWeight == fiveMatchWeight, "ExpandBasePrizeCatalog: wrong 5/5 weight");
    }

    function booksMetadataURI() public pure returns (string memory) {
        return _metadata(
            BOOKS_TOKEN_ID,
            "Lucky Signal Books",
            "A redeemable Lucky Signal books prize awarded by the digital slot machine.",
            "BOOKS",
            "#F4C95D",
            "<path d='M220 260h165c38 0 65 18 75 45 10-27 37-45 75-45h45v270h-45c-42 0-64 15-75 43-11-28-33-43-75-43H220z' fill='none' stroke='#F4C95D' stroke-width='18'/><path d='M460 305v268' stroke='#F4C95D' stroke-width='14'/>"
        );
    }

    function waterBottleMetadataURI() public pure returns (string memory) {
        return _metadata(
            WATER_BOTTLE_TOKEN_ID,
            "Lucky Signal Water Bottle",
            "A redeemable Lucky Signal reusable water bottle prize awarded by the digital slot machine.",
            "BOTTLE",
            "#66D9E8",
            "<path d='M355 220h90v70l38 50v230c0 30-24 54-54 54h-48c-30 0-54-24-54-54V340l38-50z' fill='none' stroke='#66D9E8' stroke-width='18'/><path d='M350 400h110M355 250h90' stroke='#66D9E8' stroke-width='14'/>"
        );
    }

    function capsMetadataURI() public pure returns (string memory) {
        return _metadata(
            CAPS_TOKEN_ID,
            "Lucky Signal Caps",
            "A redeemable Lucky Signal cap prize awarded by the digital slot machine.",
            "CAPS",
            "#A88BEB",
            "<path d='M235 460c18-128 91-205 195-205s177 77 195 205H235z' fill='none' stroke='#A88BEB' stroke-width='18'/><path d='M430 255v205M235 460c-52 0-82 25-95 70 94 28 193 18 290-30 76 34 153 42 230 23' fill='none' stroke='#A88BEB' stroke-width='16'/>"
        );
    }

    function _metadata(
        uint256 tokenId,
        string memory tokenName,
        string memory description,
        string memory label,
        string memory accent,
        string memory artwork
    ) private pure returns (string memory) {
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'>",
                        "<rect width='800' height='800' rx='64' fill='#171421'/>",
                        "<circle cx='650' cy='150' r='210' fill='",
                        accent,
                        "' opacity='.18'/>",
                        "<rect x='64' y='64' width='672' height='672' rx='44' fill='none' stroke='",
                        accent,
                        "' stroke-width='6'/>",
                        "<text x='100' y='145' fill='#F7F4ED' font-family='monospace' font-size='30' letter-spacing='5'>LUCKY SIGNAL</text>",
                        artwork,
                        "<text x='100' y='680' fill='#F7F4ED' font-family='monospace' font-size='28'>",
                        label,
                        "  /  ON-CHAIN PRIZE  #",
                        tokenId.toString(),
                        "</text></svg>"
                    )
                )
            )
        );

        bytes memory json = abi.encodePacked(
            '{"name":"',
            tokenName,
            '","description":"',
            description,
            '","image":"',
            image,
            '","attributes":[{"trait_type":"Prize ID","value":',
            tokenId.toString(),
            '},{"trait_type":"Collection","value":"Lucky Signal Rewards"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
