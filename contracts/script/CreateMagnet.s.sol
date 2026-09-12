// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

import {SlotPrize1155} from "../src/SlotPrize1155.sol";

contract CreateMagnet is Script {
    uint256 public constant BASE_MAINNET_CHAIN_ID = 8_453;
    uint256 public constant MAGNET_TOKEN_ID = 5;
    address public constant PRIZE_COLLECTION = 0x8D411D8efCDb0d528E4F6659B44223264Fd0B719;
    address public constant SLOT_MACHINE = 0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c;

    function run() external returns (uint256 tokenId) {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "CreateMagnet: wrong chain");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        SlotPrize1155 collection = SlotPrize1155(PRIZE_COLLECTION);

        require(collection.owner() == deployer, "CreateMagnet: deployer is not owner");
        require(collection.nextTokenId() == MAGNET_TOKEN_ID, "CreateMagnet: unexpected next token ID");

        vm.startBroadcast(deployerKey);
        tokenId = collection.createAndMint(SLOT_MACHINE, 1, magnetMetadataURI());
        vm.stopBroadcast();

        require(tokenId == MAGNET_TOKEN_ID, "CreateMagnet: unexpected token ID");
    }

    function magnetMetadataURI() public pure returns (string memory) {
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(
                bytes(
                    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'>"
                    "<rect width='800' height='800' rx='64' fill='#171421'/>"
                    "<circle cx='650' cy='150' r='210' fill='#FF6B6B' opacity='.18'/>"
                    "<rect x='64' y='64' width='672' height='672' rx='44' fill='none' stroke='#FF6B6B' stroke-width='6'/>"
                    "<text x='100' y='145' fill='#F7F4ED' font-family='monospace' font-size='30' letter-spacing='5'>LUCKY SIGNAL</text>"
                    "<path d='M245 240v235c0 205 310 205 310 0V240H440v235c0 52-80 52-80 0V240z' fill='#FF6B6B'/>"
                    "<rect x='245' y='240' width='115' height='92' fill='#8EA8FF'/>"
                    "<rect x='440' y='240' width='115' height='92' fill='#8EA8FF'/>"
                    "<text x='100' y='650' fill='#F7F4ED' font-family='monospace' font-size='28'>MAGNET  /  ON-CHAIN PRIZE  #5</text>"
                    "</svg>"
                )
            )
        );

        bytes memory json = abi.encodePacked(
            '{"name":"Lucky Signal Magnet",',
            '"description":"A redeemable Lucky Signal magnet prize awarded by the digital slot machine.",',
            '"image":"',
            image,
            '","attributes":[{"trait_type":"Prize ID","value":5},',
            '{"trait_type":"Collection","value":"Lucky Signal Rewards"}]}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
