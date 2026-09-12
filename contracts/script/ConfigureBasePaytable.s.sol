// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";

import {DigitalSlotMachine} from "../src/DigitalSlotMachine.sol";

contract ConfigureBasePaytable is Script {
    uint256 public constant BASE_MAINNET_CHAIN_ID = 8_453;
    address public constant SLOT_MACHINE = 0xc0253B67E835500aC9a69214fa4F2Bbce61CA72c;
    address public constant PRIZE_COLLECTION = 0x8D411D8efCDb0d528E4F6659B44223264Fd0B719;

    address public constant NVIDIA = 0xb20000000000000000000078ee7ce2fE4908108C;
    address public constant SPACEX = 0xb2000000000000000000007b9fcbd005511aCBd5;
    address public constant APPLE = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address public constant ALPHABET = 0xb2000000000000000000002D0BA3164cc74f58B7;
    address public constant AMAZON = 0xb200000000000000000000d9192b6B456483C2E8;
    address public constant GOLD = 0xe908475f8Beb7A138B0dc6eb5A05cb27068ffB9A;

    uint256 public constant STOCK_PRIZE_AMOUNT = 100_000; // 0.001 at 8 decimals
    uint256 public constant GOLD_PRIZE_AMOUNT = 1_000_000_000_000_000; // 0.001 at 18 decimals
    uint256 public constant ERC1155_PRIZE_AMOUNT = 1;
    uint256 public constant FREE_SPIN_PRIZE_AMOUNT = 1;

    function run() external {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "ConfigureBasePaytable: wrong chain");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        DigitalSlotMachine slot = DigitalSlotMachine(SLOT_MACHINE);

        require(slot.hasRole(slot.GAME_MANAGER_ROLE(), deployer), "ConfigureBasePaytable: missing manager role");
        require(slot.activeRoundCount() == 0, "ConfigureBasePaytable: active rounds");
        require(slot.configuredPrizeCount() == 0, "ConfigureBasePaytable: paytable is not empty");
        require(slot.noWinWeight() == 101, "ConfigureBasePaytable: unexpected no-win weight");
        require(slot.totalOutcomeWeight() == 101, "ConfigureBasePaytable: unexpected initial total");

        vm.startBroadcast(deployerKey);
        slot.configurePrize(0, DigitalSlotMachine.PrizeKind.ERC1155, PRIZE_COLLECTION, 5, ERC1155_PRIZE_AMOUNT, 94, 62); // MAGNET
        slot.configurePrize(1, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, FREE_SPIN_PRIZE_AMOUNT, 73, 48); // FREE_SPIN
        slot.configurePrize(2, DigitalSlotMachine.PrizeKind.ERC20, NVIDIA, 0, STOCK_PRIZE_AMOUNT, 48, 32); // STOCK1
        slot.configurePrize(3, DigitalSlotMachine.PrizeKind.ERC1155, PRIZE_COLLECTION, 1, ERC1155_PRIZE_AMOUNT, 45, 30); // GADGET
        slot.configurePrize(4, DigitalSlotMachine.PrizeKind.ERC20, SPACEX, 0, STOCK_PRIZE_AMOUNT, 38, 26); // STOCK2
        slot.configurePrize(5, DigitalSlotMachine.PrizeKind.ERC20, APPLE, 0, STOCK_PRIZE_AMOUNT, 38, 26); // STOCK3
        slot.configurePrize(6, DigitalSlotMachine.PrizeKind.ERC20, ALPHABET, 0, STOCK_PRIZE_AMOUNT, 38, 26); // STOCK4
        slot.configurePrize(7, DigitalSlotMachine.PrizeKind.ERC20, AMAZON, 0, STOCK_PRIZE_AMOUNT, 30, 20); // STOCK5
        slot.configurePrize(8, DigitalSlotMachine.PrizeKind.ERC1155, PRIZE_COLLECTION, 2, ERC1155_PRIZE_AMOUNT, 0, 100); // ENS_REGISTRATION
        slot.configurePrize(9, DigitalSlotMachine.PrizeKind.ERC1155, PRIZE_COLLECTION, 3, ERC1155_PRIZE_AMOUNT, 0, 67); // URBE_HUB_DAY_PASS
        slot.configurePrize(10, DigitalSlotMachine.PrizeKind.ERC1155, PRIZE_COLLECTION, 4, ERC1155_PRIZE_AMOUNT, 0, 45); // SHIRT
        slot.configurePrize(11, DigitalSlotMachine.PrizeKind.ERC20, GOLD, 0, GOLD_PRIZE_AMOUNT, 0, 13); // GOLD
        vm.stopBroadcast();

        require(slot.configuredPrizeCount() == 12, "ConfigureBasePaytable: incomplete catalog");
        require(slot.totalOutcomeWeight() == 1_000, "ConfigureBasePaytable: incomplete probability total");
    }
}
