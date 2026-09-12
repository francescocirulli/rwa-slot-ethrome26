// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {SlotPrize1155} from "../src/SlotPrize1155.sol";
import {ENSVoucherRedemption} from "../src/ENSVoucherRedemption.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
contract ENSVoucherRedemptionTest is Test {
    SlotPrize1155 prize;
    ENSVoucherRedemption redemption;
    uint256 key=1234;
    address player=address(0xCAFE);
    bytes32 id=keccak256("claim");
    bytes32 labelHash=keccak256("frank");
    function setUp() public {prize=new SlotPrize1155(address(this));redemption=new ENSVoucherRedemption(address(prize),vm.addr(key));prize.mint(player,2,3);}
    function permit(bytes32 claimId,address owner,uint64 deadline) internal view returns(bytes memory) {
        bytes32 digest=MessageHashUtils.toEthSignedMessageHash(redemption.authorizationHash(claimId,owner,labelHash,deadline));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(key,digest);return abi.encode(claimId,labelHash,deadline,abi.encodePacked(r,s,v));
    }
    function testConsumesExactlyOneVoucherAndRecordsRecoveryState() public {
        bytes memory data=permit(id,player,uint64(block.timestamp+100));
        vm.prank(player);prize.safeTransferFrom(player,address(redemption),2,1,data);
        assertEq(prize.balanceOf(player,2),2);assertEq(prize.balanceOf(address(redemption),2),1);
        (address owner,bytes32 lh,)=redemption.consumptions(id);assertEq(owner,player);assertEq(lh,labelHash);
        vm.prank(player);vm.expectRevert(ENSVoucherRedemption.InvalidVoucher.selector);prize.safeTransferFrom(player,address(redemption),2,1,data);
    }
    function testRejectsChangedWalletAndExpiredPermit() public {
        bytes memory data=permit(id,address(1),uint64(block.timestamp+100));
        vm.prank(player);vm.expectRevert(ENSVoucherRedemption.InvalidVoucher.selector);prize.safeTransferFrom(player,address(redemption),2,1,data);
        data=permit(id,player,uint64(block.timestamp+100));vm.warp(block.timestamp+101);
        vm.prank(player);vm.expectRevert(ENSVoucherRedemption.InvalidVoucher.selector);prize.safeTransferFrom(player,address(redemption),2,1,data);
    }
    function testRejectsOtherPrizesQuantitiesAndCollections() public {
        bytes memory data=permit(id,player,uint64(block.timestamp+100));
        vm.prank(player);vm.expectRevert(ENSVoucherRedemption.InvalidVoucher.selector);prize.safeTransferFrom(player,address(redemption),2,2,data);
        prize.mint(player,1,1);vm.prank(player);vm.expectRevert(ENSVoucherRedemption.InvalidVoucher.selector);prize.safeTransferFrom(player,address(redemption),1,1,data);
        vm.expectRevert(ENSVoucherRedemption.InvalidVoucher.selector);redemption.onERC1155Received(player,player,2,1,data);
    }
}
